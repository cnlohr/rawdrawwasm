all : index.html

CFLAGS:=-Irawdraw

#

CFLAGS+=-DWASM -nostdlib --target=wasm32 \
		-flto \
		-Wl,--lto-O3 \
		-Wl,--no-entry \
		-Wl,--allow-undefined \
		-Wl,--import-memory

#		-Wl,--export-dynamic
#		-Wl,--strip-all \
#		-Wl,--export-all \


index.html : template.ht main.wasm
	sh -c 'export BLOB=$$(cat main.wasm | base64 -w 0); envsubst < template.ht > $@'

main.wasm: rawdraw.c
	clang $(CFLAGS) $^ -o $@
	wasm-opt --asyncify -Oz main.wasm -o main.wasm
	#uglifyjs opt.js -o opt.js

clean:
	rm -rf main.wasm opt.js index.html
