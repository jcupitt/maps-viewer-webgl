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

typedef int (*MapDirFn)( const char *dirname, const char *filename, 
	void *client );

static int
map_dir( const char *dirname, MapDirFn fn, void *client )
{
	GDir *dir;
	const char *filename;

	if( !(dir = g_dir_open( dirname, 0, NULL )) ) 
		return( -1 ); 

	while( (filename = g_dir_read_name( dir )) ) {
		if( fn( dirname, filename, client ) ) {
			g_dir_close( dir );
			return( -1 );
		}
	}

	g_dir_close( dir );

	return( 0 );
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
		printf( "match failed\n" ); 
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

	mt->levelname = levelname;
	subdirname = g_build_filename( dirname, levelname, NULL );

	if( map_dir( subdirname, move_file, mt ) ) {
		g_free( subdirname );
		return( -1 ); 
	}

	g_free( subdirname );

	return( 0 );
}

static int
rmtree_fn( const char *dirname, const char *filename, void *client )
{
	char *subname;

	subname = g_build_filename( dirname, filename, NULL );
	if( g_file_test( subname, G_FILE_TEST_IS_DIR ) ) {
		if( map_dir( subname, rmtree_fn, NULL ) )
			return( -1 );
		printf( "g_rmdir( %s )\n", subname );
	}
	else
		printf( "g_unlink( %s )\n", subname );

	g_free( subname );

	return( 0 );
}

static int
rmtree( const char *dirname )
{
	return( map_dir( dirname, rmtree_fn, NULL ) );
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

	mt.outdir = outdir;
	mt.fromdir = fromdir;
	mt.todir = todir;
	mt.suffix = suffix;

	dirname = g_build_filename( outdir, fromdir, NULL );

	if( map_dir( dirname, move_level, &mt ) ) {
		g_free( dirname );
		return( -1 ); 
	}

	g_free( dirname );

	return( 0 );
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
	char *subname;

	if( VIPS_INIT( argv[0] ) )
		vips_error_exit( NULL ); 
	if( argc != 3 ) 
		vips_error_exit( "usage: %s input.ptm output-directory", 
			argv[0] ); 

	if( !(fp = fopen( argv[1], "rb" )) )
		vips_error_exit( "unable to open %s\n", argv[1] );

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

	move_tiles( argv[2], "H_pyramid_files", basename, "_1" ); 
	move_tiles( argv[2], "L_pyramid_files", basename, "_2" ); 

	subname = g_build_filename( argv[2], "H_pyramid_files", NULL );
	rmtree( subname );
	g_free( subname );

	subname = g_build_filename( argv[2], "L_pyramid_files", NULL );
	rmtree( subname );
	g_free( subname );

	subname = g_build_filename( argv[2], "H_pyramid.dzi", NULL );
	rmtree( subname );
	g_free( subname );

	subname = g_build_filename( argv[2], "L_pyramid.dzi", NULL );
	rmtree( subname );
	g_free( subname );

	return( 0 );
}
