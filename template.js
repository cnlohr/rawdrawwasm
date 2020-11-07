//Portions of code from zNoctum and redline2466

//Our memory should be publicly accessable on the global object/
//So, we use 'var'.  Also note that we're starting with a lot of pages.
var memory = new WebAssembly.Memory({initial:200});
var HEAP8 = new Int8Array(memory.buffer);
var HEAPU8 = new Uint8Array(memory.buffer);
var HEAP16 = new Int16Array(memory.buffer);
var HEAPU16 = new Uint16Array(memory.buffer);
var HEAP32 = new Uint32Array(memory.buffer);
var HEAPU32 = new Uint32Array(memory.buffer);
var HEAPF32 = new Float32Array(memory.buffer);
var HEAPF64 = new Float64Array(memory.buffer);

let blob = atob('${BLOB}');
let toUtf8Decoder = new TextDecoder( "utf-8" );
function toUTF8(ptr) {
	var len = 0|0; ptr |= 0;
	for( var i = ptr; HEAPU8[i] != 0; i++) len++;
	return toUtf8Decoder.decode(HEAPU8.subarray(ptr, ptr+len));
}

let wasmExports;
const DATA_ADDR = 16; // Where the unwind/rewind data structure will live.
let sleeping = false;
let fullscreen = false;

//Configure WebGL Stuff (allow to be part of global context)
var canvas = document.getElementById('canvas');
var wgl = canvas.getContext('webgl');
var wgl_rdcolor = new Uint8Array(4);
var wgl_shader = null;
var wgl_blit = null;
var wgl_tex = null;

//Utility stuff for WebGL sahder creation.
function wgl_makeShader( vertText, fragText )
{
	var vert = wgl.createShader(wgl.VERTEX_SHADER);
	wgl.shaderSource(vert, vertText );
	wgl.compileShader(vert);
	if (!wgl.getShaderParameter(vert, wgl.COMPILE_STATUS)) {
			alert(wgl.getShaderInfoLog(vert));
	}

	var frag = wgl.createShader(wgl.FRAGMENT_SHADER);
	wgl.shaderSource(frag, fragText );
	wgl.compileShader(frag);
	if (!wgl.getShaderParameter(frag, wgl.COMPILE_STATUS)) {
			alert(wgl.getShaderInfoLog(frag));
	}
	var ret = wgl.createProgram();
	wgl.attachShader(ret, frag);
	wgl.attachShader(ret, vert);
	wgl.linkProgram(ret);
	wgl.bindAttribLocation( ret, 0, "a0" );
	wgl.bindAttribLocation( ret, 1, "a1" );
	return ret;
}

{
	//We load two shaders, one is a solid-color shader, for most rawdraw objects.
	wgl_shader = wgl_makeShader( 
		"uniform vec2 sw, sa; attribute vec2 a0; attribute vec4 a1; varying vec4 vc; void main() { gl_Position = vec4( a0*sw-sa, 0.0, 0.5 ); vc = a1; }",
		"precision mediump float; varying vec4 vc; void main() { gl_FragColor = vec4(vc.xyz,1.0); }" );

	swloc = wgl.getUniformLocation(wgl_shader, "sw" );
	saloc = wgl.getUniformLocation(wgl_shader, "sa" );

	//We load two shaders, the other is a texture shader, for blitting things.
	wgl_blit = wgl_makeShader( 
		"uniform vec2 sw, sa;attribute vec2 a0; attribute vec4 a1; varying vec2 tc; void main() { gl_Position = vec4( a0*sw-sa, 0.0, 0.5 ); tc = a1.xy; }",
		"precision mediump float; varying vec2 tc; uniform sampler2D tex; void main() { gl_FragColor = texture2D(tex,tc);}" );

	swlocBlit = wgl.getUniformLocation(wgl_blit, "sw" );
	salocBlit = wgl.getUniformLocation(wgl_blit, "sa" );

	//Compile the shaders.
	wgl.useProgram(wgl_shader);

	//Get some vertex/color buffers, to put geometry in.
	var arraybufferV = wgl.createBuffer();
	var arraybufferC = wgl.createBuffer();

	//We're using two buffers, so just enable them, now.
	wgl.enableVertexAttribArray(0);
	wgl.enableVertexAttribArray(1);
}

//Do webgl work that must happen every frame.
function FrameStart()
{
	if( fullscreen )
	{
		wgl.viewportWidth = canvas.width = window.innerWidth;
		wgl.viewportHeight = canvas.height = window.innerHeight;
	}
	
	wgl.viewport( 0, 0, wgl.viewportWidth, wgl.viewportHeight );
	wgl.uniform2f( swloc, 1./wgl.viewportWidth, -1./wgl.viewportHeight );
	//XXX Is the nudge correct?
	//0.5, -.5 to fix center.
	//0.5/... to fix kerning so lines show up in middle of pixels.
	wgl.uniform2f( saloc, 0.5+0.5/wgl.viewportWidth, -.5-0.5/wgl.viewportHeight );
}

//Buffered geometry system.
//This handles buffering a bunch of lines/segments, and using them all at once.
var wgl_dcount;
var wgl_bdt;
var wgl_bds = 32768|0;
var wgl_bdal = new Float32Array( wgl_bds*2 );  //We have to use float's for lines.
var wgl_bdap = new Int16Array( wgl_bds*2 ); //But we can use ints for polys.
var wgl_bdac = new Uint8Array( wgl_bds*4 );
var wgl_last_width = 1;

//This function "flush"es any pending geometry to draw to screen.
function WGLFBuffer()
{
	wgl.bindBuffer(wgl.ARRAY_BUFFER, arraybufferV);
	if( (wgl_bdt == wgl.TRIANGLES) )
	{
		wgl.bufferData(wgl.ARRAY_BUFFER, wgl_bdap, wgl.DYNAMIC_DRAW);
		wgl.vertexAttribPointer(0, 2, wgl.SHORT, false, 0, 0);
	}
	else
	{
		wgl.bufferData(wgl.ARRAY_BUFFER, wgl_bdal, wgl.DYNAMIC_DRAW);
		wgl.vertexAttribPointer(0, 2, wgl.FLOAT, false, 0, 0);
	}

	wgl.bindBuffer(wgl.ARRAY_BUFFER, arraybufferC);
	wgl.bufferData(wgl.ARRAY_BUFFER, wgl_bdac, wgl.DYNAMIC_DRAW);
	wgl.vertexAttribPointer(1, 4, wgl.UNSIGNED_BYTE, true, 0, 0);

	wgl.drawArrays(wgl_bdt, 0, wgl_dcount );
	wgl_dcount = 0;
}


//This defines the list of imports, the things that C will be importing from Javascript.
//To use functions here, just call them.  Surprisingly, signatures justwork.
const imports = {
	env: {
		CNFGTackSegment: (x1, y1, x2, y2) => {
			if( wgl_bdt != wgl.LINES || wgl_dcount > wgl_bds-4 ) WGLFBuffer();
			wgl_bdt = wgl.LINES;
			wgl_bdal.set( [x1,y1,x2,y2], wgl_dcount*2 );
			wgl_bdac.set( wgl_rdcolor, wgl_dcount*4 );
			wgl_bdac.set( wgl_rdcolor, wgl_dcount*4+4 );
			wgl_dcount += 2;
		},
		CNFGTackPixel : (x1, y1 ) => {
			if( wgl_bdt != wgl.LINES || wgl_dcount > wgl_bds-4 ) WGLFBuffer();
			wgl_bdt = wgl.LINES;
			//Hack, this looks like a pixel, But makes rendering really fast.
			wgl_bdal.set( [x1,y1-wgl_last_width/2,x1,y1+wgl_last_width/2], wgl_dcount*2 );
			wgl_bdac.set( wgl_rdcolor, wgl_dcount*4 );
			wgl_bdac.set( wgl_rdcolor, wgl_dcount*4+4 );
			wgl_dcount += 2;
		},
		CNFGTackRectangle : (x1, y1, x2, y2) => {
			if( wgl_bdt != wgl.TRIANGLES || wgl_dcount > wgl_bds-16 ) WGLFBuffer();
			wgl_bdt = wgl.TRIANGLES;
			wgl_bdap.set( [x1,y1,x2,y1,x2,y2,x1,y1,x2,y2,x1,y2], wgl_dcount*2 );
			wgl_bdac.set( wgl_rdcolor, wgl_dcount*4+0 );
			wgl_bdac.set( wgl_rdcolor, wgl_dcount*4+4 );
			wgl_bdac.set( wgl_rdcolor, wgl_dcount*4+8 );
			wgl_bdac.set( wgl_rdcolor, wgl_dcount*4+12 );
			wgl_bdac.set( wgl_rdcolor, wgl_dcount*4+16 );
			wgl_bdac.set( wgl_rdcolor, wgl_dcount*4+20 );
			wgl_dcount += 6;
		},
		CNFGTackPoly: (vertices, numverts) => {
			var i = 0 | 0;
			numverts |= 0;
			vertices |= 0;
			if( numverts < 1 ) return;
			wgl.enableVertexAttribArray(0);
			var outverts =  (numverts-2) * 3;
			if( wgl_bdt != wgl.TRIANGLES || wgl_dcount > wgl_bds-outverts*2 ) WGLFBuffer();
			var i = 0|0;
			//This process vans an arbitrary polygon around a specific vertex.
			//TODO: TESTME, might be wrong.
			for( ; i < (numverts-2); i++ )
			{
				wgl_bdac.set( wgl_rdcolor, wgl_dcount*4+0 );
				wgl_bdac.set( wgl_rdcolor, wgl_dcount*4+4 );
				wgl_bdac.set( wgl_rdcolor, wgl_dcount*4+8 );
				wgl_bdap.set( HEAP16.slice(vertices>>1,(vertices>>1)+6), wgl_dcount*2 );
				wgl_dcount += 3;
			}
			wgl_bdt = wgl.TRIANGLES;
		},
		CNFGColor : (color) => {
			wgl_rdcolor[0] = (color&0xff);
			wgl_rdcolor[1] = ((color>>8)&0xff);
			wgl_rdcolor[2] = ((color>>16)&0xff);
			wgl_rdcolor[3] = ((color>>24)&0xff);
		},
		CNFGSetup : (title,w,h ) => {
			document.title = toUTF8( title );
			wgl.viewportWidth = canvas.width = w;
			wgl.viewportHeight = canvas.height = h;
			FrameStart();
			fullscreen = false;
		},
		CNFGSetupFullscreen : (title,w,h ) => {
			document.title = toUTF8( title );
			wgl.viewportWidth = canvas.width = w;
			wgl.viewportHeight = canvas.height = h;
			FrameStart();
			canvas.style = "position:absolute; top:0; left:0;"
			fullscreen = true;
		},
		CNFGClearFrameInternal: ( color ) => {
			wgl.clearColor( (color&0xff)/255., ((color>>8)&0xff)/255., ((color>>16)&0xff)/255., ((color>>24)&0xff)/255. ); 
			wgl.clear( wgl.COLOR_BUFFER_BIT | wgl.COLOR_DEPTH_BIT );
		},
		CNFGGetDimensions: (pw, ph) => {
			HEAP16[pw>>1] = canvas.width;
			HEAP16[ph>>1] = canvas.height;
		},
		CNFGHandleInput: () => {
			//?? Do something here?
		},
		CNFGUpdateScreenWithBitmapInternal : (memptr, w, h ) => {
			if( w <= 0 || h <= 0 ) return;

			if( wgl_dcount > 0 ) WGLFBuffer();

			wgl.useProgram(wgl_blit);

			if( wgl_tex == null )	wgl_tex = wgl.createTexture(); //Most of the time we don't use textures, so don't initiate at start.

			wgl.activeTexture(wgl.TEXTURE0);
			wgl.bindTexture(wgl.TEXTURE_2D, wgl_tex);

			//Make a bogus quad.
			wgl_bdt = wgl.TRIANGLES;
			wgl_bdap.set( [0,0,    w,0,      w,h,        0,0,    w,h,        0,h ], 0 );
			wgl_bdac.set( [0,0,0,0,255,0,0,0,255,255,0,0,0,0,0,0,255,255,0,0,0,255,0,0], 0 );
			wgl_dcount = 6;
 
			wgl.uniform2f( swlocBlit, 1./wgl.viewportWidth, -1./wgl.viewportHeight );
			wgl.uniform2f( salocBlit, 0.5, -.5 );  //Note that unlike saloc, we don't have an extra offset.

			wgl.texParameteri(wgl.TEXTURE_2D, wgl.TEXTURE_WRAP_S, wgl.CLAMP_TO_EDGE);
			wgl.texParameteri(wgl.TEXTURE_2D, wgl.TEXTURE_WRAP_T, wgl.CLAMP_TO_EDGE);
			wgl.texParameteri(wgl.TEXTURE_2D, wgl.TEXTURE_MIN_FILTER, wgl.NEAREST);

 			var img = new Image();
			wgl.texImage2D(wgl.TEXTURE_2D, 0, wgl.RGBA, w, h,
				0, wgl.RGBA, wgl.UNSIGNED_BYTE, new Uint8Array(memory.buffer,memptr,w*h*4) );

			WGLFBuffer();

			wgl.useProgram(wgl_shader);
		},
		CNFGFlushRender : WGLFBuffer,
		CNFGSetLineWidth : (px) => { wgl_last_width = px; wgl.lineWidth( px ); },
		CNFGSwapBuffersInternal: () => {
			if (!sleeping) {
				WGLFBuffer();

				// We are called in order to start a sleep/unwind.
				// Fill in the data structure. The first value has the stack location,
				// which for simplicity we can start right after the data structure itself.
				HEAP32[DATA_ADDR >> 2] = DATA_ADDR + 8;
				// The end of the stack will not be reached here anyhow.
				HEAP32[DATA_ADDR + 4 >> 2] = 1024;
				wasmExports.asyncify_start_unwind(DATA_ADDR);
				sleeping = true;
				// Resume after the proper delay.
				requestAnimationFrame(function() {
					FrameStart();
					wasmExports.asyncify_start_rewind(DATA_ADDR);
					// The code is now ready to rewind; to start the process, enter the
					// first function that should be on the call stack.
					wasmExports.main();
				});
			} else {
				// We are called as part of a resume/rewind. Stop sleeping.
				wasmExports.asyncify_stop_rewind();
				sleeping = false;
			}
		},
		OGGetAbsoluteTime : () => { return new Date().getTime()/1000.; },
		Add1 : (i) => { return i+1; }, //Super simple function for speed testing.
		sin : Math.sin, //Tricky - math functions just automatically link through.
		cos : Math.cos,
		tan : Math.tan,
		sinf : Math.sin,
		cosf : Math.cos,
		tanf : Math.tan,
		OGUSleep: (us) => {
			if (!sleeping) {
				// We are called in order to start a sleep/unwind.
				//console.log('sleep...');
				// Fill in the data structure. The first value has the stack location,
				// which for simplicity we can start right after the data structure itself.
				HEAP32[DATA_ADDR >> 2] = DATA_ADDR + 8;
				// The end of the stack will not be reached here anyhow.
				HEAP32[DATA_ADDR + 4 >> 2] = 1024;
				wasmExports.asyncify_start_unwind(DATA_ADDR);
				sleeping = true;
				// Resume after the proper delay.
				setTimeout(function() {
					wasmExports.asyncify_start_rewind(DATA_ADDR);
					// The code is now ready to rewind; to start the process, enter the
					// first function that should be on the call stack.
					wasmExports.main();
				}, us/1000);
			} else {
				// We are called as part of a resume/rewind. Stop sleeping.
				wasmExports.asyncify_stop_rewind();
				sleeping = false;
			}
		},
		memory: memory,
		print: console.log,
		prints: (str) => { console.log(toUTF8(str)); },
	}
};


{
	// Actually load the WASM blob.
	var array = new Uint8Array(new ArrayBuffer(blob.length));
	var i = 0|0;
	for(i = 0; i < blob.length; i++) {
		array[i] = blob.charCodeAt(i);
	}


	WebAssembly.instantiate(array, imports).then(
		function(wa) { 
			instance = wa.instance;
			wasmExports = instance.exports;

			//Attach inputs.
			if( instance.exports.HandleMotion )
			{
				canvas.addEventListener('mousemove', e => { instance.exports.HandleMotion( e.offsetX, e.offsetY, e.buttons ); } );
				canvas.addEventListener('touchmove', e => { instance.exports.HandleMotion( e.touches[0].clientX, e.touches[0].clientY, 1 ); } );
			}

			if( instance.exports.HandleButton )
			{
				canvas.addEventListener('mouseup', e => { instance.exports.HandleButton( e.offsetX, e.offsetY, e.button, 0 ); } );
				canvas.addEventListener('mousedown', e => { instance.exports.HandleButton( e.offsetX, e.offsetY, e.button, 1 ); } );
			}


			//Actually invoke main().  Note that, upon "CNFGSwapBuffers" this will 'exit'
			//But, will get re-entered from the swapbuffers animation callback.
			instance.exports.main();
		 } );
}
