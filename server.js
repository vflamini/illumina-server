const express = require("express");
const fileUpload = require("express-fileupload");
const app = express();
const cors = require("cors");
const port = process.env.port || 5000;
const util = require("util");
const exec  = util.promisify(require("child_process").exec);
const path = require('path');
const JSZip = require('jszip');
const fs = require('fs');
const Papa = require("papaparse");
const zlib = require('zlib');
var bodyParser = require('body-parser');
var spawn = require("child_process").spawn;

const globalProgress = {};

app.use(cors());
app.use(express.json());
app.use('/static', express.static(path.join(__dirname, 'public')))
app.use(fileUpload());
app.use(bodyParser.json());

app.get("/", (req,res) => {
    res.sendFile(path.join(__dirname,"index.html"));
})

app.post("/sendIllumina", async (req,res) => {
    res.writeHead(200, {
        Connection: "keep-alive",
        "Content-Type": "text/event-stream",
        "Cache-Control": "no-cache",
    });
    var finished = true;
    const fileArray = req.files.File;
    var progress = {};
    var regExpMatch;
    console.log("processing...");
    await fileArray.forEach(async file => {
        await fs.writeFileSync(path.join(__dirname,"tmp",file.name),file.data);
        const fileContents = fs.createReadStream(path.join(__dirname,"tmp",file.name));
        const writeStream = fs.createWriteStream(path.join(__dirname,"tmp",file.name.slice(0,file.name.length-3)));
        const unzip = zlib.createGunzip();

        await fileContents.pipe(unzip).pipe(writeStream);
        fs.exists(path.join(__dirname,"tmp",file.name), exists => {
            if(exists){
                fs.unlink(path.join(__dirname,"tmp",file.name), async err => {
                    if(err){
                        console.log(err);
                    }
                });
            }
        });
        if(file.name.includes('R1')){
            // exec('mkdir -p ./tmp/clonal_lineage & mkdir -p ./tmp/stdout_dumps', (stdout,stderr,error) => {
            //     if(error){
            //         console.log('exec error: ' + error);
            //     }else{
            //         exec('AssemblePairs.py align -1 ./tmp/' + file.name.slice(0,file.name.length-3) + ' -2 ./tmp/' + file.name.slice(0,file.name.length-3).replace('R1','R2') + ' --coord illumina --outname clonal_lineage/' + file.name.slice(0,file.name.length-16) + " >> ./tmp/stdout_dumps/" + file.name.slice(0,file.name.length-16) + "_stdout_dump.txt", (error,stdout,stderr) => {
            //             console.log('stdout: ' + stdout);
            //             console.log('stderr: ' + stderr);
            //             if(error){
            //                 console.log('exec error: ' + error);
            //             }else{
                            
            //             }
            
            //         })
            //     }
            // });
            exec('mkdir -p ./tmp/clonal_lineage & mkdir -p ./tmp/stdout_dumps', (stdout,stderr,error) => {
                if(error){
                    console.log('exec error: ' + error);
                }else{
                    console.log("Assembling pairs...");
                    spawn('AssemblePairs.py', ['align', '-1', './tmp/' + file.name.slice(0,file.name.length-3),'-2', './tmp/' + file.name.slice(0,file.name.length-3).replace('R1','R2'),'--coord', 'illumina', '--outname', 'clonal_lineage/' + file.name.slice(0,file.name.length-16)]).stdout.on('data', data => {
                        if(data){
                            regExpMatch = data.toString().match(/.{3}%/g);
                            if (regExpMatch){
                                progress[file.name.slice(0,file.name.length-16)] = data.toString().match(/.{3}%/g)[0];
                                res.write('data:'+JSON.stringify(progress) + '\n\n');
                            }  
                        }
                        finished = true;
                        Object.keys(progress).map(key => {
                            if(progress[key].replaceAll(' ','') !== "100%"){
                                finished = false;
                            }
                        });
                        if(finished){
                            progress = {};
                            console.log("Filtering seqs...");
                            spawn('FilterSeq.py', ['quality', '-s', './tmp/clonal_lineage/' + file.name.slice(0,file.name.length-16) + '_assemble-pass.fastq', '-q', '20', '--outname', 'filtered/' + file.name.slice(0,file.name.length-16)]).stdout.on('data', data => {
                                if(data){
                                    regExpMatch = data.toString().match(/.{3}%/g);
                                    if (regExpMatch){
                                        progress[file.name.slice(0,file.name.length-16)] = data.toString().match(/.{3}%/g)[0];
                                        res.write('data:'+JSON.stringify(progress) + '\n\n');
                                    }  
                                }
                                finished = true;
                                Object.keys(progress).map(key => {
                                    if(progress[key].replaceAll(' ','') !== "100%"){
                                        finished = false;
                                    }
                                });
                                if(finished){
                                    progress = {};
                                    console.log("Collapsing seqs...");
                                    spawn('CollapseSeq.py', ['-s', './tmp/clonal_lineage/filtered/' + file.name.slice(0,file.name.length-16) + '_assemble-pass.fastq', '--fasta', '-n','1', '--outname', 'collapsed/' + file.name.slice(0,file.name.length-16)]).stdout.on('data', data => {
                                        if(data){
                                            progress[file.name.slice(0,file.name.length-16)] = data.toString().match(/.{3}%/g)[0];
                                            res.write('data:'+JSON.stringify(progress) + '\n\n');
                                        }
                                        finished = true;
                                        Object.keys(progress).map(key => {
                                            if(progress[key].replaceAll(' ','') !== "100%"){
                                                finished = false;
                                            }
                                        });
                                        if(finished){
                                            var zip = new JSZip();
                                            zip.folder("./tmp/clonal_lineage/filtered/collapsed")
                                            var promise = null;
                                            if (JSZip.support.uint8array) {
                                                promise = zip.generateAsync({type: "uint8array"}).then(blob => {
                                                    saveAs(blob, "collapsed.zip");
                                                });
                                            }else{
                                                promise = zip.generateAsynce({type: "string"}).then(blob => {
                                                    saveAs(blob, "collapsed.zip");
                                                });
                                            }
                                            res.end();
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
    console.log("done processing");
});

app.listen(port, () => { console.log(`Server is running on ${port}`) });
