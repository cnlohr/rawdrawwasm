# rawdrawwasm

My stab at rawdraw on wasm.  This is based on:
 https://github.com/zNoctum/wasm-tool
and has inspiration from:
 https://github.com/cnlohr/wasm_integrated

Lots of stuff todo, hopefully this will get rolled into main rawdraw.

TODO notes for now:
 * hook up button presses, and mouse input and destroy
 * hook up sleep in a more meaningful way maybe?
 * Make printf work.
 * Make libc work.
 * Figure out how to #include math.h
 * Come up with guide on how to use this.

Check it out, live: https://cnlohr.github.io/rawdrawwasm/



This was something I found convenient for a while...
```

	function wasmloaded(wa)
	{
		instance = wa;
		wasmExports = instance.exports;
		instance.exports.main();
	}

	//If at all possible, we should attempt to load in-thread
	//This will make the load not flash.
	if( blob.length < 4096 )
	{
		let mod = new WebAssembly.Module(array);
		var wa = new WebAssembly.Instance( mod, imports );
 		wasmloaded( wa );
	}
	else
	{
		WebAssembly.instantiate(array, imports).then( function(wa) { wasmloaded(wa.instance); } );
	}
```

