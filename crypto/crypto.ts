import * as ethers from 'ethers'

import { SNARK_FIELD_SIZE, SnarkBigInt, bigInt, genRandomSalt, hash5, hashOne, hashLeftRight } from 'maci-crypto'

// A nothing-up-my-sleeve zero value
// Should be equal to 16916383162496104613127564537688207714240750091683495371401923915264313510848
const NOTHING_UP_MY_SLEEVE =
    bigInt(ethers.utils.solidityKeccak256(['bytes'], [ethers.utils.toUtf8Bytes('Unirep')])) % SNARK_FIELD_SIZE

const wrappedPoseidonT3Hash = (...elements: SnarkBigInt[]): string => {
    let result: SnarkBigInt
    if ( elements.length == 1) {
        result = hashOne(elements[0])
    } else if ( elements.length == 2) {
        result = hashLeftRight(elements[0], elements[1])
    } else {
        throw new Error(`elements length should not greater than 2, got ${elements.length}`)
    }

    return ethers.utils.hexZeroPad('0x' + result.toString(16), 32)
}

export {
    NOTHING_UP_MY_SLEEVE,
    SNARK_FIELD_SIZE,
    SnarkBigInt,
    bigInt,
    genRandomSalt,
    hash5,
    hashOne,
    hashLeftRight,
    wrappedPoseidonT3Hash,
}