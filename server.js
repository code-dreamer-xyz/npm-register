'use strict';

let koa      = require('koa');
let gzip     = require('koa-gzip');
let r        = require('koa-route');
let morgan   = require('koa-morgan');
let parse    = require('co-body');
let fs       = require('fs');
let packages = require('./lib/packages');
let tarballs = require('./lib/tarballs');
let config   = require('./lib/config');
let user     = require('./lib/user');
let app      = koa();

app.name = 'elephant';
app.port = config.port;

app.use(morgan.middleware(config.production ? 'combined' : 'dev'));
app.use(gzip());

// static root page
app.use(r.get('/', function* () {
  this.type = 'text/html';
  this.body = fs.createReadStream(__dirname + '/public/index.html');
}));

// error middleware
app.use(function* (next) {
  try { yield next; }
  catch (err) {
    this.status = err.status || 500;
    this.body   = {error: err.message};
    this.app.emit('error', err, this);
  }
});

// get package metadata
app.use(r.get('/:name', function *(name) {
  let etag = this.req.headers['if-none-match'];
  let pkg = yield packages.get(name, etag);
  if (pkg === 304 || pkg === 404) {
    this.status = pkg;
    return;
  }
  packages.rewriteHost(pkg, config.uplink.hostname, this.headers.host);
  this.set('ETag', pkg.etag);
  this.set('Cache-Control', `public, max-age=${config.cache.packageMaxAge}`);
  this.body = pkg;
}));

// get package tarball
app.use(r.get('/:name/-/:filename', function *(name, filename) {
  let tarball = yield tarballs.get(name, filename);
  if (!tarball) {
    this.status = 404;
    this.body   = {error: 'no tarball found'};
    return;
  }
  this.set('Content-Length', tarball.size);
  this.set('Cache-Control', 'public, max-age=86400');
  this.body = tarball;
}));

// login
app.use(r.put('/-/user/:user', function *() {
  let auth = yield user.authenticate(yield parse(this));
  if (auth) {
    this.status = 201;
    this.body   = {token: auth};
  } else {
    this.status = 401;
    this.body   = {error: "invalid credentials"};
  }
}));

// authenticate
app.use(function* (next) {
  if (!this.headers.authorization) {
    this.status = 401;
    this.body   = {error: 'no credentials provided'};
    return;
  }
  let token = this.headers.authorization.split(' ')[1];
  this.username = yield user.findByToken(token);
  if (!this.username) {
    this.status = 401;
    this.body   = {error: 'invalid credentials'};
    return;
  }
  yield next;
});

// whoami
app.use(r.get('/-/whoami', function *() {
  this.body = {username: this.username};
}));

// npm publish
app.use(r.put('/:name', function *(name) {
  let pkg      = yield parse(this);
  let existing = yield packages.get(name);
  let versions = Object.keys(existing.versions);
  if (versions.indexOf(pkg['dist-tags'].latest) !== -1) {
    this.status = 409;
    this.body   = {error: 'this version already present'};
    return;
  }
  this.body = 'fooooooooo';
}));

module.exports = app;
if (!module.parent) {
  app.listen(app.port, function () {
    console.log(`${app.name} listening on port ${app.port} [${app.env}]`);
  });
}
