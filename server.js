const express = require("express");
const fileUpload = require("express-fileupload");
const app = express();
const cors = require("cors");
const port = process.env.port || 5000;
const util = require("util");
const exec = util.promisify(require("child_process").exec); // spawn synchronous linux cmd windows in background
const path = require('path');
const JSZip = require('jszip');
const fs = require('fs');
const Papa = require("papaparse");
const zlib = require('zlib');
var bodyParser = require('body-parser');
var spawn = require("child_process").spawn; // spawn simultaneous, asynchronous linux cmd windows in background
var FileSaver = require("file-saver");
var AdmZip = require('adm-zip');


// use needed express functionalities
app.use(cors());
app.use(express.json());
app.use('/static', express.static(path.join(__dirname, 'public')))
app.use(fileUpload());
app.use(bodyParser.json());

// send default HTML on get request to home page --- unneeded
app.get("/", (req,res) => {
    res.sendFile(path.join(__dirname,"index.html"));
})

// handle get request to get finalized zip file using identifier
app.get("/getCollapsedZip", (req,res) => {
    const fileName = path.join(__dirname,"tmp","identifier_collapsed.zip");
    const fileType = "application/zip";
    var zip = new AdmZip();
    zip.addLocalFolder("./tmp/clonal_lineage/filtered/collapsed");
    var fileContents = zip.toBuffer()
    res.writeHead(200, {
        "Content-Disposition": `attachment; filename="${fileName}"`,
        "Content-Type": fileType,
    })
    res.end(fileContents);
    
})

// handle post request to analyze data --- this does the heavy-lifting
app.post("/sendIllumina", async (req,res) => {
    console.time("doSomething");
    res.writeHead(200, {
        Connection: "keep-alive",
        "Content-Type": "text/event-stream",
        "Cache-Control": "no-cache",
    });
    var finished = false;
    const fileArray = req.files.File;
    var progress = {};
    var regExpMatch;
    var endMatch;
    var finishedCount = 0;
    console.log("processing...");
    await fileArray.forEach(async (file,idx) => {
        // write received zip files to a file locally
        if(file.name.slice(file.name.length-3,file.name.length) == ".gz" || file.name.slice(file.name.length-6,file.name.length) == ".fastq"){
            console.log(file.name.slice(file.name.length-3,file.name.length));
        
        fs.writeFileSync(path.join(__dirname,"tmp",file.name),file.data);

        // execute gunzip locally synchronously
        exec('gunzip ./tmp/' + file.name, (stdout,stderr,error) => {
            if(error){
                console.log(error);
            }else{
                console.log(stdout);
            }
            // only operate on singles of file pairs
            if(file.name.includes('R1')){
                // create necessary folders and initialize the working space locally
                exec('mkdir -p ./tmp/clonal_lineage && ls && mkdir -p ./tmp/clonal_lineage/filtered && mkdir -p ./tmp/clonal_lineage/filtered/collapsed', (stdout,stderr,error) => {
                    if(error){
                        console.log('exec error: ' + error);
                    }else{
                        console.log("Assembling pairs...");
                        // assemble pairs using immcantation
                        spawn('AssemblePairs.py', ['align', '-1', './tmp/' + file.name.slice(0,file.name.length-3),'-2', './tmp/' + file.name.slice(0,file.name.length-3).replace('R1','R2'),'--coord', 'illumina', '--outname', 'clonal_lineage/' + file.name.slice(0,file.name.length-16)]).stdout.on('data', data => {
                            if(data){
                                console.log(data.toString());
                                // find percentage/end declaration from std out 
                                regExpMatch = data.toString().match(/.{3}%/g);
                                endMatch = data.toString().match(/.END>/g);
                                if (regExpMatch){
                                    // update progress object with progress of each file
                                    progress[file.name.slice(0,file.name.length-16)] = data.toString().match(/.{3}%/g)[0];
                                    // push progress update to client
                                    res.write('data:'+JSON.stringify(progress) + '\n\n');
                                }
                                if(endMatch){
                                    finished = true;
                                }
                            }
                            if(finished){
                                finished = false;
                                console.log("Filtering seqs...");
                                // filter seqs using immcantation
                                spawn('FilterSeq.py', ['quality', '-s', './tmp/clonal_lineage/' + file.name.slice(0,file.name.length-16) + '_assemble-pass.fastq', '-q', '20', '--outname', 'filtered/' + file.name.slice(0,file.name.length-16)]).stdout.on('data', data => {
                                    if(data){
                                        console.log(data.toString());
                                        regExpMatch = data.toString().match(/.{3}%/g);
                                        endMatch = data.toString().match(/.END>/g);
                                        if (regExpMatch){
                                            progress[file.name.slice(0,file.name.length-16)] = data.toString().match(/.{3}%/g)[0];
                                            res.write('data:'+JSON.stringify(progress) + '\n\n');
                                        }
                                        if(endMatch){
                                            finished = true;
                                        } 
                                    }
                                    if(finished){
                                        finished = false;
                                        console.log("Collapsing seqs...");
                                        // collapse seqs using immcantation
                                        spawn('CollapseSeq.py', ['-s', './tmp/clonal_lineage/filtered/' + file.name.slice(0,file.name.length-16) + '_quality-pass.fastq', '--fasta', '-n','1', '--outname', 'collapsed/' + file.name.slice(0,file.name.length-16)]).stdout.on('data', data => {
                                            if(data){
                                                console.log(data.toString());
                                                regExpMatch = data.toString().match(/.{3}%/g);
                                                endMatch = data.toString().match(/.END>/g);
                                                if (regExpMatch){
                                                    progress[file.name.slice(0,file.name.length-16)] = data.toString().match(/.{3}%/g)[0];
                                                    res.write('data:'+JSON.stringify(progress) + '\n\n');
                                                }  
                                                if(endMatch){
                                                    finished = true;
                                                }
                                            }
                                            if(finished){
                                                finished = false;
                                                finishedCount++;
                                                var zip = new JSZip();
                                                // send collapse file to zip
                                                fs.readFile('./tmp/clonal_lineage/filtered/collapsed/' + file.name.slice(0,file.name.length-16) + '_collapse-unique.fasta', 'utf-8', (err,data) => {
                                                    zip.file(file.name.slice(0,file.name.length-16) + '_collapse-unique.fasta', data);
                                                    // once finished --- generate file stream for zip, pipe to write file
                                                    if(finishedCount === Math.floor(fileArray.length/2)){
                                                        zip.generateNodeStream({type: 'nodebuffer', streamFiles: true})
                                                            .pipe(fs.createWriteStream('./tmp/identifier_collapsed.zip'))
                                                            .on('finish', () => {
                                                                console.log('identifier_collapsed.zip written');
                                                                console.timeEnd('doSomething');
                                                            })
                                                        // end continuous input to client
                                                        res.end();
                                                    }
                                                })
                                            }
                                        });
                                    }
                                });
                            }
                        });
                    }
                });
            }
        });
    }
    });
});

app.listen(port, () => { console.log(`Server is running on ${port}`) });
