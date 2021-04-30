import base64url from 'base64url'
import { ethers as hardhatEthers } from 'hardhat'
import { ethers } from 'ethers'
import { genIdentityCommitment, unSerialiseIdentity } from 'libsemaphore'
import { hashLeftRight, hashOne, stringifyBigInts } from 'maci-crypto'
import mongoose from 'mongoose'

import {
    promptPwd,
    validateEthSk,
    validateEthAddress,
    checkDeployerProviderConnection,
    contractExists,
} from './utils'

import { DEFAULT_ETH_PROVIDER, DEFAULT_START_BLOCK } from './defaults'
import { dbUri } from '../config/database';

import { add0x } from '../crypto/SMT'
import { genUserStateFromContract } from '../core'

import Unirep from "../artifacts/contracts/Unirep.sol/Unirep.json"
import { identityPrefix, identityCommitmentPrefix, reputationProofPrefix } from './prefix'

import Post, { IPost } from "../database/models/post";
import { DEFAULT_POST_KARMA, MAX_KARMA_BUDGET } from '../config/socialMedia'
import { assert } from 'console'
import { formatProofForVerifierContract, genVerifyEpochKeyProofAndPublicSignals, genVerifyReputationProofAndPublicSignals, getSignalByNameViaSym, verifyEPKProof, verifyProveReputationProof } from '../test/circuits/utils'
import { genEpochKey, genKarmaNullifier } from '../test/utils'
import { nullifierTreeDepth } from '../config/testLocal'
import { genProveReputationCircuitInputsFromDB } from '../database/utils'

const configureSubparser = (subparsers: any) => {
    const parser = subparsers.addParser(
        'publishPost',
        { addHelp: true },
    )

    parser.addArgument(
        ['-e', '--eth-provider'],
        {
            action: 'store',
            type: 'string',
            help: `A connection string to an Ethereum provider. Default: ${DEFAULT_ETH_PROVIDER}`,
        }
    )

    parser.addArgument(
        ['-tx', '--text'],
        {
            required: true,
            type: 'string',
            help: 'The text written in the post',
        }
    )

    parser.addArgument(
        ['-id', '--identity'],
        {
            required: true,
            type: 'string',
            help: 'The (serialized) user\'s identity',
        }
    )

    parser.addArgument(
        ['-n', '--epoch-key-nonce'],
        {
            required: true,
            type: 'int',
            help: 'The epoch key nonce',
        }
    )

    parser.addArgument(
        ['-kn', '--karma-nonce'],
        {
            required: true,
            type: 'int',
            help: `The first nonce to generate karma nullifiers. It will generate ${DEFAULT_POST_KARMA} nullifiers`,
        }
    )

    parser.addArgument(
        ['-mr', '--min-rep'],
        {
            type: 'int',
            help: 'The minimum reputation score the user has',
        }
    )

    parser.addArgument(
        ['-x', '--contract'],
        {
            required: true,
            type: 'string',
            help: 'The Unirep contract address',
        }
    )

    parser.addArgument(
        ['-db', '--from-database'],
        {
            action: 'storeTrue',
            help: 'Indicate if to generate proving circuit from database',
        }
    )

    const privkeyGroup = parser.addMutuallyExclusiveGroup({ required: true })

    privkeyGroup.addArgument(
        ['-dp', '--prompt-for-eth-privkey'],
        {
            action: 'storeTrue',
            help: 'Whether to prompt for the user\'s Ethereum private key and ignore -d / --eth-privkey',
        }
    )

    privkeyGroup.addArgument(
        ['-d', '--eth-privkey'],
        {
            action: 'store',
            type: 'string',
            help: 'The deployer\'s Ethereum private key',
        }
    )
}

const publishPost = async (args: any) => {

    // Unirep contract
    if (!validateEthAddress(args.contract)) {
        console.error('Error: invalid Unirep contract address')
        return
    }

    const unirepAddress = args.contract

    // Ethereum provider
    const ethProvider = args.eth_provider ? args.eth_provider : DEFAULT_ETH_PROVIDER

    let ethSk
    // The deployer's Ethereum private key
    // The user may either enter it as a command-line option or via the
    // standard input
    if (args.prompt_for_eth_privkey) {
        ethSk = await promptPwd('Your Ethereum private key')
    } else {
        ethSk = args.eth_privkey
    }

    if (!validateEthSk(ethSk)) {
        console.error('Error: invalid Ethereum private key')
        return
    }

    if (! (await checkDeployerProviderConnection(ethSk, ethProvider))) {
        console.error('Error: unable to connect to the Ethereum provider at', ethProvider)
        return
    }

    const provider = new hardhatEthers.providers.JsonRpcProvider(ethProvider)
    const wallet = new ethers.Wallet(ethSk, provider)

    if (! await contractExists(provider, unirepAddress)) {
        console.error('Error: there is no contract deployed at the specified address')
        return
    }

    const startBlock = (args.start_block) ? args.start_block : DEFAULT_START_BLOCK
    const unirepContract = new ethers.Contract(
        unirepAddress,
        Unirep.abi,
        wallet,
    )
    const attestingFee = await unirepContract.attestingFee()
    // Validate epoch key nonce
    const epkNonce = args.epoch_key_nonce
    const numEpochKeyNoncePerEpoch = await unirepContract.numEpochKeyNoncePerEpoch()
    if (epkNonce >= numEpochKeyNoncePerEpoch) {
        console.error('Error: epoch key nonce must be less than max epoch key nonce')
        return
    }
    const encodedIdentity = args.identity.slice(identityPrefix.length)
    const decodedIdentity = base64url.decode(encodedIdentity)
    const id = unSerialiseIdentity(decodedIdentity)
    const commitment = genIdentityCommitment(id)
    const currentEpoch = (await unirepContract.currentEpoch()).toNumber()
    const treeDepths = await unirepContract.treeDepths()
    const epochTreeDepth = treeDepths.epochTreeDepth
    const epk = genEpochKey(id.identityNullifier, currentEpoch, epkNonce, epochTreeDepth).toString(16)

    // gen nullifier nonce list
    const proveKarmaNullifiers = BigInt(1)
    const proveKarmaAmount = BigInt(DEFAULT_POST_KARMA)
    const nonceStarter: number = args.karma_nonce
    const nonceList: BigInt[] = []
    for (let i = 0; i < DEFAULT_POST_KARMA; i++) {
        nonceList.push( BigInt(nonceStarter + i) )
    }

    // gen minRep proof
    const proveMinRep = args.min_rep != null ? BigInt(1) : BigInt(0)
    const minRep = args.min_rep != null ? BigInt(args.min_rep) : BigInt(0)

    let circuitInputs: any

    if(args.from_database){

        console.log('generating proving circuit from database...')
        
         // Gen epoch key proof and reputation proof from database
        circuitInputs = await genProveReputationCircuitInputsFromDB(
            currentEpoch,
            id,
            epkNonce,                       // generate epoch key from epoch nonce
            proveKarmaNullifiers,           // indicate to prove karma nullifiers
            proveKarmaAmount,               // the amount of output karma nullifiers
            nonceList,                      // nonce to generate karma nullifiers
            proveMinRep,                    // indicate to prove minimum reputation the user has
            minRep                          // the amount of minimum reputation the user wants to prove
        )

    } else {

        console.log('generating proving circuit from contract...')

        // Gen epoch key proof and reputation proof from Unirep contract
        const userState = await genUserStateFromContract(
            provider,
            unirepAddress,
            startBlock,
            id,
            commitment,
        )

        circuitInputs = await userState.genProveReputationCircuitInputs(
            epkNonce,                       // generate epoch key from epoch nonce
            proveKarmaNullifiers,           // indicate to prove karma nullifiers
            proveKarmaAmount,               // the amount of output karma nullifiers
            nonceList,                      // nonce to generate karma nullifiers
            proveMinRep,                    // indicate to prove minimum reputation the user has
            minRep                          // the amount of minimum reputation the user wants to prove
        )
    }

    const results = await genVerifyReputationProofAndPublicSignals(stringifyBigInts(circuitInputs))
    const nullifiers: BigInt[] = [] 
    
    for (let i = 0; i < MAX_KARMA_BUDGET; i++) {
        const variableName = 'main.karma_nullifiers['+i+']'
        nullifiers.push(getSignalByNameViaSym('proveReputation', results['witness'], variableName))
    }
    
    // TODO: Not sure if this validation is necessary
    const isValid = await verifyProveReputationProof(results['proof'], results['publicSignals'])
    if(!isValid) {
        console.error('Error: reputation proof generated is not valid!')
        return
    }

    const proof = formatProofForVerifierContract(results['proof'])
    const epochKey = BigInt(add0x(epk))
    const encodedProof = base64url.encode(JSON.stringify(proof))
    
    const publicSignals = results['publicSignals']
    
    if(proveMinRep){
        console.log(`Prove minimum reputation: ${minRep}`)
    }
    
    const newpost: IPost = new Post({
        content: args.text,
        // TODO: hashedContent
        epochKey: epk,
        epkProof: base64url.encode(JSON.stringify(proof)),
        proveMinRep: Boolean(proveMinRep),
        minRep: Number(minRep),
        comments: [],
        status: 0
    });

    let tx
    try {
        tx = await unirepContract.publishPost(
            BigInt(add0x(newpost._id.toString())), 
            epochKey,
            args.text, 
            publicSignals, 
            proof,
            nullifiers,
            { value: attestingFee, gasLimit: 1000000 }
        )
        if (args.from_database){
            const db = await mongoose.connect(
                dbUri, 
                { useNewUrlParser: true, 
                  useFindAndModify: false, 
                  useUnifiedTopology: true
                }
            )
            const res: IPost = await newpost.save()
            db.disconnect();
        }
    } catch(e) {
        console.error('Error: the transaction failed')
        if (e.message) {
            console.error(e.message)
        }
        return
    }
    
    console.log('Post ID:', newpost._id.toString())
    console.log('Transaction hash:', tx.hash)
    console.log(`Epoch key of epoch ${currentEpoch} and nonce ${epkNonce}: ${epk}`)
    console.log(reputationProofPrefix + encodedProof)
}

export {
    publishPost,
    configureSubparser,
}