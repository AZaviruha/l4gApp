var gulp = require('gulp');
var uglify = require('gulp-uglify');
var requirejs = require('gulp-requirejs');
var rename = require('gulp-rename');

var DEST = './out';

gulp.task('lib', function() {
	return requirejs({
		baseUrl: './lib',
		name: '../node_modules/almond/almond',
		paths: {
			'packages/underscore': 'empty:',
			'packages/backbone': 'empty:',
			'packages/jquery': 'empty:'
		},
		include: ['application'],
		wrap: {
			start: 'define(["packages/underscore", "packages/jquery", "packages/backbone"], function(_, $, Backbone) {',
			end: ';define("packages/underscore", function(){ return _;});' 
			+ 'define("packages/jquery", function(){ return $;});' 
			+ 'define("packages/backbone", function(){ return Backbone;});' 
			+ 'return require("application");});'
		},
		optimize: 'none',
		out: 'l4g-app.js'
	})
	.pipe(gulp.dest(DEST))
	.pipe(rename('l4g-app.min.js'))
	.pipe(uglify())
	.pipe(gulp.dest(DEST));
});

gulp.task('default', ['lib']);