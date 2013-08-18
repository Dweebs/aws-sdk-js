/**
 * Copyright 2012-2013 Amazon.com, Inc. or its affiliates. All Rights Reserved.
 *
 * Licensed under the Apache License, Version 2.0 (the "License"). You
 * may not use this file except in compliance with the License. A copy of
 * the License is located at
 *
 *     http://aws.amazon.com/apache2.0/
 *
 * or in the "license" file accompanying this file. This file is
 * distributed on an "AS IS" BASIS, WITHOUT WARRANTIES OR CONDITIONS OF
 * ANY KIND, either express or implied. See the License for the specific
 * language governing permissions and limitations under the License.
 */

var fs = require('fs');
var util = require('util');
var browserify = require('browserify');
var path = require('path');
var through = require('through');
var _ = require('underscore');

var root = path.normalize(path.join(__dirname, '..', 'lib'));
var sanitizeRegex = /[^a-zA-Z0-9-]/g;
var defaultServices = 'dynamodb,s3,sts';

function generateBundleFile(services, callback) {
  var serviceMap = parseServiceMap(services, function (err, serviceMap) {
    if (err) return callback(err);

    var contents = ['var AWS = require("./core"); module.exports = AWS;'];

    _.each(serviceMap, function (versions, service) {
      _.each(versions, function (version) {
        var line = util.format(
          '%s(require("./services/%s"), "%s", require("./services/api/%s-%s"));',
          'AWS.Service.defineServiceApi', service, version, service, version);
        contents.push(line);
      });
    });

    callback(null, contents.join('\n'));
  });
}

function parseServiceMap(services, callback) {
  if (!services) services = defaultServices;
  services = services.split(',').map(function (s) {
    return s.replace(sanitizeRegex, '');
  });

  var dir = path.join(root, 'services', 'api');  
  fs.readdir(dir, function (err, files) {
    var diskMap = mapFromNames(files);
    if (services.length === 1 && services[0] === 'all') {
      return callback(null, diskMap); // all services
    }

    var givenMap = mapFromNames(services);
    var invalidModules = [];

    _.each(givenMap, function (versions, service) {
      if (!diskMap[service]) { // no such service
        invalidModules.push(service);
      } else if (versions.length === 0) { // take latest
        givenMap[service] = [diskMap[service][diskMap[service].length - 1]];
      } else { // validate all versions
        _.each(versions, function (version) {
          if (diskMap[service].indexOf(version) < 0) {
            invalidModules.push(service + '-' + version);
          }
        });
      }
    });

    if (invalidModules.length > 0) {
      callback(new Error('Missing modules: ' + invalidModules.join(', ')));
    } else {
      callback(null, givenMap);
    }
  });
}

function mapFromNames(names) {
  var map = {};
  _.each(names, function (name) {
    var match = name.match(/^(.+?)(?:-(.+?)(?:\.js)?)?$/);
    var service = match[1], version = match[2];
    if (!map[service]) map[service] = [];
    if (version) map[service].push(version);
  });
  return map;
}

module.exports = function(file, servicesPassed) {
  var services = servicesPassed ? file :
    (process.env.hasOwnProperty('SERVICES') ? process.env.SERVICES : null);

  function transform(file) {
    if (!file.match(/\/lib\/aws\.js$/)) return through();

    function write() { }
    function end() {
      var self = this;
      generateBundleFile(services, function (err, bundle) {
        if (err) self.emit('error', err);
        else {
          self.queue(bundle);
          self.queue(null);
        }
      });
    }

    return through(write, end);
  };

  if (!servicesPassed) {
    return transform(file);
  } else {
    return transform;
  }
}