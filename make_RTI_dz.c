/* Create an RTI DZI pyramid. This ia a port of the Puython tool here:
 *
 * 	https://github.com/jcupitt/maps-viewer-webgl/blob/master/make_RTI_dz.py
 *
 * This C version makes a .exe in Windows and saves us having to install
 * Python everywhere.
 *
 * Compile with:
 *
 * 	cc -g -Wall make_RTI_dz.c `pkg-config vips --cflags --libs`
 *
 * 28/7/2015
 *  - quick hack
 */

#include <stdio.h>
#include <stdlib.h>
#include <string.h>

#include <vips/vips.h>

/* Windows stdio.h is missing LINE_MAX.
 */
#ifndef LINEMAX
#define LINE_MAX (1024)
#endif

typedef int (*MapDirFn)( const char *dirname, const char *filename, 
	void *client );

static int
map_dir( const char *dirname, MapDirFn fn, void *client )
{
	GDir *dir;
	const char *filename;
	int result;

	if( !(dir = g_dir_open( dirname, 0, NULL )) ) 
		return( -1 ); 

	result = 0;
	while( (filename = g_dir_read_name( dir )) ) {
		if( (result = fn( dirname, filename, client )) ) 
			break;
	}

	g_dir_close( dir );

	return( result );
}

typedef struct _MoveTiles {
	const char *outdir;
	const char *fromdir;
	const char *todir;
	const char *suffix;
	const char *levelname;
} MoveTiles;

static int
move_file( const char *dirname, const char *filename, void *client )
{
	MoveTiles *mt = (MoveTiles *) client;

	char **components;
	char *start;

	char *old_name;
	char *new_name;

	int result;

	components = g_regex_split_simple( "(.*).jpeg", filename, 0, 0 );
	if( strcmp( components[0], filename ) == 0 ) {
		vips_error( "move_file", "match failed for %s", filename ); 
		g_strfreev( components ); 
		return( -1 );
	}
	start = components[1];

	old_name = g_build_filename( dirname, filename, NULL );
	new_name = g_strdup_printf( "%s/%s_files/%s/%s%s.jpeg",
		mt->outdir, mt->todir, mt->levelname, start, mt->suffix );

	if( (result = g_rename( old_name, new_name )) )
		vips_error( "move_file", "unable to rename %s as %s",
			old_name, new_name ); 

	g_free( old_name ); 
	g_free( new_name ); 

	g_strfreev( components ); 

	return( result );
}

static int
move_level( const char *dirname, const char *levelname, void *client )
{
	MoveTiles *mt = (MoveTiles *) client;

	char *subdirname;
	int result;

	mt->levelname = levelname;
	subdirname = g_build_filename( dirname, levelname, NULL );
	result = map_dir( subdirname, move_file, mt );
	g_free( subdirname );

	return( result );
}

/* Params are eg.
 *
 * 	@outdir: /home/john/poop
 * 	@fromdir: L_pyramid_files
 * 	@todir: poop
 * 	@suffix: _1
 *
 * all the tiles matching /home/john/poop/L_pyramid_files/ * / *_*.jpeg
 * are moved into the appropriate spot in /home/john/poop/poop_files
 *
 * tile names have _1 inserted just before the .jpeg extension
 */
static int
move_tiles( char *outdir, char *fromdir, char *todir, char *suffix )
{
	MoveTiles mt;
	char *dirname;
	int result;

	mt.outdir = outdir;
	mt.fromdir = fromdir;
	mt.todir = todir;
	mt.suffix = suffix;

	dirname = g_build_filename( outdir, fromdir, NULL );
	result = map_dir( dirname, move_level, &mt );
	g_free( dirname );

	return( result );
}

static int
rmtree_action( const char *pathname )
{
	int result;

	if( g_file_test( pathname, G_FILE_TEST_IS_DIR ) ) 
		result = g_rmdir( pathname ); 
	else
		result = g_unlink( pathname ); 

	if( result )
		vips_error( "rmtree", "unable to remove %s", pathname );

	return( result );
}

static int
rmtree_fn( const char *dirname, const char *filename, void *client )
{
	char *subname;

	subname = g_build_filename( dirname, filename, NULL );

	if( g_file_test( subname, G_FILE_TEST_IS_DIR ) ) {
		if( map_dir( subname, rmtree_fn, NULL ) )
			return( -1 );
	}

	rmtree_action( subname ); 

	g_free( subname );

	return( 0 );
}

static int
rmtree( const char *fmt, ... )
{
	va_list ap;
	char *pathname;
	int result;

	va_start( ap, fmt );
	pathname = g_strdup_vprintf( fmt, ap ); 
	if( g_file_test( pathname, G_FILE_TEST_IS_DIR ) ) 
		result = map_dir( pathname, rmtree_fn, NULL );
	if( !result )
		result = rmtree_action( pathname ); 
	g_free( pathname ); 
	va_end( ap ); 

	return( result );
}

static int
metadata_copy( FILE *old_fp, FILE *new_fp, double scale[6], double offset[6] )
{
	char line[LINE_MAX];

	while( fgets( line, LINE_MAX, old_fp ) ) {
		if( strcmp( line, "</Image>\n" ) == 0 ) {
			int i;
			fprintf( new_fp, "  <RTI format=\"lrgb\">\n" ); 
			fprintf( new_fp, "   <scale>" ); 
			for( i = 0; i < 6; i++ )
				fprintf( new_fp, "%g ", scale[i] ); 
			fprintf( new_fp, "</scale>\n" ); 
			fprintf( new_fp, "   <offset>" ); 
			for( i = 0; i < 6; i++ )
				fprintf( new_fp, "%g ", offset[i] ); 
			fprintf( new_fp, "</offset>\n" ); 
			fprintf( new_fp, "  </RTI>\n" ); 
		}

		fprintf( new_fp, "%s", line );
	}

	return( 0 );
}

static int
metadata_add( const char *outdir, const char *name, 
	double scale[6], double offset[6] )
{
	char *old_dziname;
	char *new_dziname;
	FILE *old_fp;
	FILE *new_fp;
	int result;

	result = 0; 

	old_dziname = g_strdup_printf( "%s/%s.dzi", outdir, name );
	new_dziname = g_strdup_printf( "%s/new_%s.dzi", outdir, name );

	old_fp = vips__file_open_read( old_dziname, NULL, TRUE );
	new_fp = vips__file_open_write( new_dziname, TRUE );
	if( !old_fp || 
		!new_fp )
		result = -1;

	if( !result )
		result = metadata_copy( old_fp, new_fp, scale, offset );

	if( !result ) {
		if( (result = g_rename( new_dziname, old_dziname )) )
			vips_error( "metadata_add", 
				"unable to rename %s as %s",
				old_dziname, new_dziname ); 
	}

	g_free( old_dziname );
	g_free( new_dziname );

	return( result );
}

int
main( int argc, char **argv )
{
	FILE *fp;
	char line[LINE_MAX];
	int width;
	int height;
	double scale[6];
	double offset[6];
	long coeff_offset;
	long rgb_offset;
	char *basename;
	VipsImage *image;
	VipsImage *t;

	if( VIPS_INIT( argv[0] ) )
		vips_error_exit( NULL ); 
	if( argc != 3 ) 
		vips_error_exit( "usage: %s input.ptm output-directory", 
			argv[0] ); 

	if( !(fp = vips__file_open_read( argv[1], NULL, FALSE )) )
		vips_error_exit( NULL ); 

	fgets( line, LINE_MAX, fp );
	if( strcmp( line, "PTM_1.2\n" ) != 0 )
		vips_error_exit( "%s is not a PTM 1.2 file\n", argv[1] );
	fgets( line, LINE_MAX, fp );
	if( strcmp( line, "PTM_FORMAT_LRGB\n" ) != 0 )
		vips_error_exit( "%s is not an LRGB PTM file\n", argv[1] );

	fgets( line, LINE_MAX, fp );
	width = atoi( line );
	fgets( line, LINE_MAX, fp );
	height = atoi( line );

	fgets( line, LINE_MAX, fp );
	if( sscanf( line, "%lg %lg %lg %lg %lg %lg", 
		&scale[0], &scale[1], &scale[2], 
		&scale[3], &scale[4], &scale[5] ) != 6 )  
		vips_error_exit( "%s does not have six scales\n", argv[1] );

	fgets( line, LINE_MAX, fp );
	if( sscanf( line, "%lg %lg %lg %lg %lg %lg", 
		&offset[0], &offset[1], &offset[2], 
		&offset[3], &offset[4], &offset[5] ) != 6 )  
		vips_error_exit( "%s does not have six offsets\n", argv[1] );

	coeff_offset = ftell( fp ); 
	rgb_offset = coeff_offset + width * height * 6;

	basename = g_path_get_basename( argv[2] ); 

	if( vips_mkdirf( "%s", argv[2] ) )
		vips_error_exit( NULL ); 

	printf( "generating RGB pyramid ...\n" ); 
	image = vips_image_new_from_file_raw( argv[1], 
		width, height, 3, rgb_offset );
	vips_snprintf( line, LINE_MAX, "%s/%s", argv[2], basename );
	if( vips_dzsave( image, line, NULL ) )
		vips_error_exit( NULL ); 
	g_object_unref( image ); 

	printf( "generating H pyramid ...\n" ); 
	image = vips_image_new_from_file_raw( argv[1], 
		width, height, 6, coeff_offset );
	if( vips_extract_band( image, &t, 0, "n", 3, NULL ) )
		vips_error_exit( NULL ); 
	g_object_unref( image ); 
	image = t;
	vips_snprintf( line, LINE_MAX, "%s/%s", argv[2], "H_pyramid" ); 
	if( vips_dzsave( image, line, NULL ) )
		vips_error_exit( NULL ); 
	g_object_unref( image ); 

	printf( "generating L pyramid ...\n" ); 
	image = vips_image_new_from_file_raw( argv[1], 
		width, height, 6, coeff_offset );
	if( vips_extract_band( image, &t, 3, "n", 3, NULL ) )
		vips_error_exit( NULL ); 
	g_object_unref( image ); 
	image = t;
	vips_snprintf( line, LINE_MAX, "%s/%s", argv[2], "L_pyramid" ); 
	if( vips_dzsave( image, line, NULL ) )
		vips_error_exit( NULL ); 
	g_object_unref( image ); 

	printf( "combining pyramids ...\n" ); 

	if( move_tiles( argv[2], "H_pyramid_files", basename, "_1" ) || 
		move_tiles( argv[2], "L_pyramid_files", basename, "_2" ) )
		vips_error_exit( NULL );

	if( rmtree( "%s/%s", argv[2], "H_pyramid_files" ) ||
		rmtree( "%s/%s", argv[2], "L_pyramid_files" ) ||
		rmtree( "%s/%s", argv[2], "H_pyramid.dzi" ) ||
		rmtree( "%s/%s", argv[2], "L_pyramid.dzi" ) )
		vips_error_exit( NULL );

	printf( "writing extra metadata ...\n" ); 
	metadata_add( argv[2], basename, scale, offset ); 

	return( 0 );
}
