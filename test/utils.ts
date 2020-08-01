import * as ethers from 'ethers'
import { deployContract, link } from "ethereum-waffle"
import { add0x } from '../crypto/SMT'
import { SnarkBigInt, SNARK_FIELD_SIZE, bigInt } from '../crypto/crypto'
import { attestingFee, epochLength, epochTreeDepth, globalStateTreeDepth, maxEpochKeyNonce, maxUsers, nullifierTreeDepth, userStateTreeDepth} from '../config/testLocal'

import Unirep from "../artifacts/Unirep.json"
import PoseidonT3 from "../artifacts/PoseidonT3.json"
import PoseidonT6 from "../artifacts/PoseidonT6.json"
import NewUserStateVerifier from "../artifacts/NewUserStateVerifier.json"

// Copy contract json type from ethereum-waffle
interface SimpleContractJSON {
    abi: any[];
    bytecode: string;
}

const linkLibrary = (contractJson: SimpleContractJSON, libraryName: string, libraryAddress: string) => {
    let linkableContract = {
        evm: {
            bytecode: {
                object: contractJson.bytecode,
            }
        }
    }
    link(linkableContract, libraryName, libraryAddress)
    contractJson.bytecode = linkableContract.evm.bytecode.object
}

const deployUnirep = async (deployer: ethers.Wallet) => {
    let PoseidonT3Contract, PoseidonT6Contract
    let NewUserStateVerifierContract

    console.log('Deploying PoseidonT3')
    PoseidonT3Contract = (await deployContract(
        deployer,
        PoseidonT3
    ))
    console.log('Deploying PoseidonT6')
    PoseidonT6Contract = (await deployContract(
        deployer,
        PoseidonT6
    ))

    console.log('Deploying NewUserStateVerifier')
    NewUserStateVerifierContract = (await deployContract(
        deployer,
        NewUserStateVerifier
    ))

    console.log('Deploying Unirep')
    // Link the library code if it has not been linked yet
    if(Unirep.bytecode.indexOf("$") > 0) {
        // Link the Unirep contract to PoseidonT3 contract
        linkLibrary(Unirep, 'contracts/Poseidon.sol:PoseidonT3', PoseidonT3Contract.address)
        // Link the Unirep contract to PoseidonT6 contract
        linkLibrary(Unirep, 'contracts/Poseidon.sol:PoseidonT6', PoseidonT6Contract.address)
    }

    return (await deployContract(
        deployer,
        Unirep,
        [
            {
                globalStateTreeDepth,
                userStateTreeDepth,
                nullifierTreeDepth,
                epochTreeDepth
            },
            {
                maxUsers,
                maxEpochKeyNonce
            },
            NewUserStateVerifierContract.address,
            epochLength,
            attestingFee
        ],
        {
            gasLimit: 9000000,
        }
    ))
}

const genEpochKey = (identityNullifier: SnarkBigInt, epoch: number, nonce: number): SnarkBigInt => {
    const epochKey = bigInt(ethers.utils.solidityKeccak256(["uint256", "uint256", "uint256"], [identityNullifier.toString(), epoch, nonce])) % SNARK_FIELD_SIZE
    // Adjust epoch key size according to epoch tree depth
    return epochKey % bigInt(2).pow(bigInt(epochTreeDepth))
}

const toCompleteHexString = (str: string, len?: number): string => {
    str = add0x(str)
    if (len) str = ethers.utils.hexZeroPad(str, len)
    return str
}

const genStubEPKProof = (isValid: Boolean) => {
    let firstElement;
    if(isValid) {
        firstElement = 1;
    } else {
        firstElement = 0;
    }
    return [firstElement, 2, 3, 4, 5, 6, 7, 8]
}

export {
    SimpleContractJSON,
    deployUnirep,
    genEpochKey,
    genStubEPKProof,
    linkLibrary,
    toCompleteHexString,
}