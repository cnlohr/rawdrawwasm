all : index.html

CFLAGS:=-Irawdraw

#

CFLAGS+=-DWASM -nostdlib --target=wasm32 \
		-flto -Oz \
		-Wl,--lto-O3 \
		-Wl,--no-entry \
		-Wl,--allow-undefined \
		-Wl,--import-memory

#		-Wl,--export-dynamic
#		-Wl,--strip-all \
#		-Wl,--export-all \


opt.js : template.js main.wasm
	bash -c 'export BLOB=$$(cat main.wasm | base64 | sed -e "$$ ! {/./s/$$/ \\\\/}" ); envsubst < template.js > opt.js.tmp'
	uglifyjs opt.js.tmp > $@
	rm opt.js.tmp

index.html : template.ht opt.js
	bash -c 'export JAVASCRIPT_DATA=$$(cat opt.js); envsubst < template.ht > $@'

main.wasm: rawdraw.c
	clang $(CFLAGS) $^ -o $@
	wasm-opt --asyncify -Oz main.wasm -o main.wasm
	#uglifyjs opt.js -o opt.js

clean:
	rm -rf main.wasm opt.js opt.js.tmp index.html
