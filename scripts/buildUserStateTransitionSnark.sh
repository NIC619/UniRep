#!/bin/bash

set -e

cd "$(dirname "$0")"
cd ..
mkdir -p build

export NODE_OPTIONS=--max-old-space-size=92160;
node scripts/buildSnarks.js -i circuits/test/userStateTransition_test.circom -j build/userStateTransitionCircuit.r1cs -w build/userStateTransition.wasm -y build/userStateTransition.sym -p build/userStateTransitionPk.json -v build/userStateTransitionVk.json -s build/UserStateTransitionVerifier.sol -vs UserStateTransitionVerifier -pr build/userStateTransition.params

echo 'Copying UserStateTransitionVerifier.sol to contracts/'
cp ./build/UserStateTransitionVerifier.sol ./contracts/