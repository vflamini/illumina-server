FROM node:13.12.0-alpine

RUN apk update && apk upgrade

# Install python/pip
ENV PYTHONUNBUFFERED=1
RUN apk add --update --no-cache python3 python3-dev && ln -sf python3 /usr/bin/python
RUN python3 -m ensurepip
RUN pip3 install --no-cache --upgrade pip setuptools

RUN apk add make \
  automake \
  gcc \
  g++ \
  subversion \
  bash libxml2-dev libxslt-dev linux-headers musl-dev gfortran openblas-dev lapack-dev

RUN pip3 install presto changeo

# set working directory
WORKDIR /app

# add `/app/node_modules/.bin` to $PATH
ENV PATH /app/node_modules/.bin:$PATH

# install app dependencies
COPY package.json ./
COPY package-lock.json ./
RUN npm install --silent

# add app
COPY . ./

# start app
# CMD ["node", "server.js"]