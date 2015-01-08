"use strict";

var phridge = require('phridge');
var mysql = require('mysql');
var nodemailer = require('nodemailer');
var connectionParams = require('/scripts/chameleon_mysql_connection.json');
var connection = mysql.createConnection(connectionParams);

// phridge.spawn() creates a new PhantomJS process
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
          return [date.getTime(), window.location.hostname + $latestFileElement.attr('href')];
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

    // thisScrape is an array with the first element being the unix timestamp of the roms build date
    // and the second element being the url to download the rom

    // connect to db
    connection.connect();


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
      var newRomFound = firstRun || thisScrape[0] > parseInt(lastScrape.rom_timestamp);
      if ( newRomFound ) {

        // mail directly from this box
        var transporter = nodemailer.createTransport();

        // setup e-mail data with unicode symbols
        var mailOptions = {
            from: 'CM Scraper✔ <cm-scraper@jor.pw>',
            to: require('/scripts/cm-scraper/email_list.json'),
            subject: 'NEW ROM',
            text: thisScrape[1],
            html: '<a href=\'' + thisScrape[1] + '\'>download</a>'
        };

        // send dat shit
        transporter.sendMail(mailOptions);
      }

    });

    // save this run
    connection.query('\
      INSERT INTO\
       `scripts`.`cm-scraper`\
          (`rom_timestamp`, `rom_url`) \
      VALUES ?;',
      [[thisScrape]], function(err, row, fields){});

    // close db connection
    connection.end();

  }, function (err) {
      // Don't forget to handle errors
      // In this case we're just throwing it
      throw err;
  });
