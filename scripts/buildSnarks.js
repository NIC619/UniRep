"use strict";
exports.__esModule = true;
var argparse = require("argparse");
var fs = require("fs");
var path = require("path");
var shell = require("shelljs");
var genVerifier_1 = require("./genVerifier");
var fileExists = function (filepath) {
    var currentPath = path.join(__dirname, '..');
    var inputFilePath = path.join(currentPath, filepath);
    var inputFileExists = fs.existsSync(inputFilePath);
    return inputFileExists;
};
var zkutilPath = "~/.cargo/bin/zkutil";
var main = function () {
    var parser = new argparse.ArgumentParser({
        description: 'Compile a circom circuit and generate its proving key, verification key, and Solidity verifier'
    });
    parser.addArgument(['-i', '--input'], {
        help: 'The filepath of the circom file',
        required: true
    });
    parser.addArgument(['-j', '--r1cs-out'], {
        help: 'The filepath to save the compiled circom file',
        required: true
    });
    parser.addArgument(['-w', '--wasm-out'], {
        help: 'The filepath to save the WASM file',
        required: true
    });
    parser.addArgument(['-y', '--sym-out'], {
        help: 'The filepath to save the SYM file',
        required: true
    });
    parser.addArgument(['-v', '--vk-out'], {
        help: 'The filepath to save the verification key',
        required: true
    });
    parser.addArgument(['-p', '--pk-out'], {
        help: 'The filepath to save the proving key (as a .json file)',
        required: true
    });
    parser.addArgument(['-s', '--sol-out'], {
        help: 'The filepath to save the Solidity verifier contract',
        required: true
    });
    parser.addArgument(['-r', '--override'], {
        help: 'Override an existing compiled circuit, proving key, and verifying key if set to true; otherwise (and by default), skip generation if a file already exists',
        action: 'storeTrue',
        required: false,
        argumentDefault: false
    });
    parser.addArgument(['-vs', '--verifier-name'], {
        help: 'The desired name of the verifier contract',
        required: true
    });
    parser.addArgument(['-pr', '--params-out'], {
        help: 'The filepath to save the params file',
        required: true
    });
    var args = parser.parseArgs();
    var vkOut = args.vk_out;
    var solOut = args.sol_out;
    var inputFile = args.input;
    var override = args.override;
    var circuitOut = args.r1cs_out;
    var symOut = args.sym_out;
    var wasmOut = args.wasm_out;
    var verifierName = args.verifier_name;
    var paramsOut = args.params_out;
    var pkOut = args.pk_out;
    // Check if the input circom file exists
    var inputFileExists = fileExists(inputFile);
    // Exit if it does not
    if (!inputFileExists) {
        console.error('File does not exist:', inputFile);
        return 1;
    }
    // Set memory options for node
    shell.env['NODE_OPTIONS'] = '--max-old-space-size=4096';
    // Check if the circuitOut file exists and if we should not override files
    var circuitOutFileExists = fileExists(circuitOut);
    if (!override && circuitOutFileExists) {
        console.log(circuitOut, 'exists. Skipping compilation.');
    }
    else {
        console.log("Compiling " + inputFile + "...");
        // Compile the .circom file
        shell.exec("node ./node_modules/circom/cli.js " + inputFile + " -r " + circuitOut + " -w " + wasmOut + " -s " + symOut);
        console.log('Generated', circuitOut, 'and', wasmOut);
    }
    var paramsFileExists = fileExists(paramsOut);
    if (!override && paramsFileExists) {
        console.log('params file exists. Skipping setup.');
    }
    else {
        console.log('Generating params file...');
        shell.exec(zkutilPath + " setup -c " + circuitOut + " -p " + paramsOut);
    }
    console.log('Exporting verification key...');
    shell.exec(zkutilPath + " export-keys -c " + circuitOut + " -p " + paramsOut + " -r " + pkOut + " -v " + vkOut);
    console.log("Generated " + pkOut + " and " + vkOut);
    var verifier = genVerifier_1.genSnarkVerifierSol(verifierName, JSON.parse(fs.readFileSync(vkOut).toString()));
    fs.writeFileSync(solOut, verifier);
    return 0;
};
if (require.main === module) {
    var exitCode = void 0;
    try {
        exitCode = main();
    }
    catch (err) {
        console.error(err);
        exitCode = 1;
    }
    process.exit(exitCode);
}
