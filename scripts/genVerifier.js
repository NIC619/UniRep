"use strict";
exports.__esModule = true;
exports.genSnarkVerifierSol = void 0;
var path = require("path");
var fs = require("fs");
var genSnarkVerifierSol = function (contractName, vk) {
    var templatePath = path.join(__dirname, './verifier_groth16.sol');
    var template = fs.readFileSync(templatePath).toString();
    template = template.replace('<%contract_name%>', contractName);
    var vkalpha1 = "uint256(" + vk.vk_alfa_1[0].toString() + ")," +
        ("uint256(" + vk.vk_alfa_1[1].toString() + ")");
    template = template.replace('<%vk_alpha1%>', vkalpha1);
    var vkbeta2 = "[uint256(" + vk.vk_beta_2[0][1].toString() + ")," +
        ("uint256(" + vk.vk_beta_2[0][0].toString() + ")], ") +
        ("[uint256(" + vk.vk_beta_2[1][1].toString() + "),") +
        ("uint256(" + vk.vk_beta_2[1][0].toString() + ")]");
    template = template.replace('<%vk_beta2%>', vkbeta2);
    var vkgamma2 = "[uint256(" + vk.vk_gamma_2[0][1].toString() + ")," +
        ("uint256(" + vk.vk_gamma_2[0][0].toString() + ")], ") +
        ("[uint256(" + vk.vk_gamma_2[1][1].toString() + "),") +
        ("uint256(" + vk.vk_gamma_2[1][0].toString() + ")]");
    template = template.replace('<%vk_gamma2%>', vkgamma2);
    var vkdelta2 = "[uint256(" + vk.vk_delta_2[0][1].toString() + ")," +
        ("uint256(" + vk.vk_delta_2[0][0].toString() + ")], ") +
        ("[uint256(" + vk.vk_delta_2[1][1].toString() + "),") +
        ("uint256(" + vk.vk_delta_2[1][0].toString() + ")]");
    template = template.replace('<%vk_delta2%>', vkdelta2);
    template = template.replace('<%vk_input_length%>', (vk.IC.length - 1).toString());
    template = template.replace('<%vk_ic_length%>', vk.IC.length.toString());
    var vi = '';
    for (var i = 0; i < vk.IC.length; i++) {
        if (vi.length !== 0) {
            vi = vi + '        ';
        }
        vi = vi + ("vk.IC[" + i + "] = Pairing.G1Point(uint256(" + vk.IC[i][0].toString() + "),") +
            ("uint256(" + vk.IC[i][1].toString() + "));\n");
    }
    template = template.replace('<%vk_ic_pts%>', vi);
    return template;
};
exports.genSnarkVerifierSol = genSnarkVerifierSol;
