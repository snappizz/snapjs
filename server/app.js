var express = require('express'),
	SnapCloud = require('./cloud').SnapCloud,
	hex_sha512 = require('./sha512');

var username = 'XXXXXXXX',
	password = 'XXXXXXXX';

SnapCloud.login(username, hex_sha512(password), function () {
	console.log('logged in');
}, function () {
	console.log('login failed :(');
	console.log(arguments);
});