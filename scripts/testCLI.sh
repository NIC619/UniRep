#!/bin/bash -xe

cd "$(dirname "$0")"
cd ..

npx buidler node &
sleep 3 && npx buidler --network local test cli/test/testAllCommands.ts
# sleep 3 && npx ts-node cli/index.ts genUnirepIdentity && npx ts-node cli/index.ts deploy -d 0xc5e8f61d1ab959b397eecc0a37a6517b8e67a0e7cf1f4bce5591f3ed80199122 