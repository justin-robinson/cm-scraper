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

    return page.run(function ( resolve, reject ) {
      var page = this;
      var url = "http://download.cyanogenmod.org/?device=vs985";
      var statusCode = null;
      var errors = [];

      // called every time an asset is loaded
      page.onResourceReceived = function(response){
        // was this our main page?
        if ( response.url === url && !statusCode ){

          // save http status code
          statusCode = response.status;

          console.log(url + " : " + response.status + " " + response.statusText);
        }
      };


      page.onResourceError = function(resourceError) {
        errors.push(resourceError);
        console.log("RESOURCE ERROR : " + resourceError.errorString);
      };

      // called on redirects
      page.onUrlChanged = function(targetURL){

        // if it actually changed
        if ( url !== targetURL ){
          console.log("Redirected from " + url + " to " + targetURL);

          // update url
          url = targetURL;

        }

      };

      console.log("opening " + url);
      page.open(url, function (status) {

        if ( status === "success" ){

          console.log("opened " + url);

          var thisScrape = page.evaluate(function () {

            // get the first row in the list of nightly roms
            var $latestFileElement = $('.table tbody tr:nth-child(1) td:nth-child(3) a:nth-of-type(1)');
            
	    // get the name of the build in the first row
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

        } else {
          console.log("failed opening " + url);
          reject("failed opening " + url );
        }

      });


    });
  })

  .then(function (thisScrape) {


    console.log("getting timestamp from last scrape");

    // get last scrape
    connection.query('\
    SELECT \
      * \
    FROM \
      `scripts`.`cm-scraper` \
    ORDER BY \
      `runID` DESC\
    LIMIT 1;', function(error, rows, fields){

      console.log("got last scrape");
      
      // last scrape saved
      var lastScrape = rows[0];

      // is this our first run?
      var firstRun = typeof lastScrape === 'undefined';

      // has an update been found?
      var newRomFound = firstRun ||  thisScrape.rom_timestamp > parseInt(lastScrape.rom_timestamp);
      if ( newRomFound ) {

        console.log("new rom found!!");

        // push to each account
        async.each(pushbulletAccessTokens,function(token, callback){

          // create a pusher object for this accout
          var pusher = new pushbullet(token);

          // get all devices on this account
          pusher.devices(function(error, response){

            if ( error ){
              callback(error);
            }
            var devices = response.devices;

            // push to each device
            async.each(devices, function(device, callback) {

              // only push to android phones
              if ( device.pushable && device.type === 'android' ){

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
            }, function(error) {
              if ( error ){
                console.log(error);
              } else {
                console.log("pushed to all devices for access token " + token);
              }
            })

          });

        },function(error){

          if ( error ){
            console.log(error);
          } else {
            console.log("pushed to all account!");
          }

        });
      }

    });


    console.log("saving this run to the db");

    // save this run
    connection.query('INSERT INTO `scripts`.`cm-scraper` SET ?', thisScrape, function(error, row, fields){});
    // close db connection
    connection.end();

  }, function (error) {
      // Don't forget to handle errors
      // In this case we're just throwing it
      throw error;
  })

  .catch(function(error){
      throw error;
  })

  // phridge.disposeAll exits cleanly all previously created child processes.
  // This should be called in any case to clean up everything.
  .finally(function(){
    console.log("closing phantom resources");
    phridge.disposeAll();
  })
