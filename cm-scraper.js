"use strict";

var phridge = require('phridge');
var mysql = require('mysql');
var pushbullet = require('pushbullet');
var pushbulletAccessTokens = require('./pushbullet_access_tokens.json');
var connectionParams = require('../chameleon_mysql_connection.json');
var connection = mysql.createConnection(connectionParams);
var async = require('async');

//creates a new PhantomJS process
phridge.spawn()

  .then(function (phantom) {

    // we are inside phantomjs here so we can't see the global scope of node
    var page = phantom.createPage();

    return page.run(function ( resolve ) {
      var page = this;

      page.open("http://download.cyanogenmod.org/?device=vs985", function (status) {

        var thisScrape = page.evaluate(function () {

          // get the latest filename
          var $latestFileElement = $('.table tbody tr:nth-child(1) td:nth-child(3) a:nth-child(3)');
          var latestFileName = $latestFileElement.html();

          // get date of latest file
          var dateParts = latestFileName.split('-')[2].match(/(\d{4})(\d{2})(\d{2})/);
          var date = new Date(
            dateParts[1],
            dateParts[2],
            dateParts[3],
            0,
            0
          );

          // return timestamp of latest rom and url
          return {
            rom_timestamp : date.getTime(),
            rom_url       : window.location.protocol + "//" + window.location.hostname + $latestFileElement.attr('href')
          };
        });

        // return this scrape back to node
        resolve(thisScrape);
      });
    });
  })


  // phridge.disposeAll exits cleanly all previously created child processes.
  // This should be called in any case to clean up everything.
  .finally(phridge.disposeAll)

  .done(function (thisScrape) {

    // get last scrape
    connection.query('\
    SELECT \
      * \
    FROM \
      `scripts`.`cm-scraper` \
    ORDER BY \
      `runID` DESC\
    LIMIT 1;', function(err, row, fields){

      // last scrape saved
      var lastScrape = row[0];

      // is this our first run?
      var firstRun = typeof lastScrape === 'undefined';

      // has an update been found?
      var newRomFound = firstRun || thisScrape.timestamp > parseInt(lastScrape.rom_timestamp);
      if ( newRomFound || true) {

        async.each(pushbulletAccessTokens,function(token, callback){

          var pusher = new pushbullet(token);

          pusher.devices(function(error, response){

            if ( error ){
              callback(error);
            }
            var devices = response.devices;

            async.each(devices, function(device, callback){
              if ( device.pushable ){
                var fileName = thisScrape.rom_url.split('/');
                fileName = fileName[fileName.length-1];
                pusher.note(device.iden, 'NEW ROM', fileName, function(error, response){
                  if ( error ){
                    callback(error);
                  } else{
                    console.log("pushed to " + response.iden);
                    callback();
                  }
                });
              }
            }, function(err) {
              if ( err ){
                console.log(err);
              } else {
                console.log("pushed to all devices for access token " + token);
              }
            })

          });

        },function(err){

          if ( err ){
            console.log(err);
          } else {
            console.log("pushed to all account!");
          }

        });
      }

    });

    // save this run
    connection.query('INSERT INTO `scripts`.`cm-scraper` SET ?', thisScrape, function(err, row, fields){});
    // close db connection
    connection.end();

  }, function (err) {
      // Don't forget to handle errors
      // In this case we're just throwing it
      throw err;
  });
