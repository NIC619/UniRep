import assert from 'assert'
import { ethers } from 'ethers'
import {
    hashLeftRight,
    IncrementalQuinTree,
    hash5,
} from 'maci-crypto'
import { SparseMerkleTreeImpl } from '../crypto/SMT'
import { computeEmptyUserStateRoot, genNewSMT, SMT_ONE_LEAF, SMT_ZERO_LEAF } from '../test/utils'

interface IEpochTreeLeaf {
    epochKey: BigInt;
    hashchainResult: BigInt;
}

const DefaultHashchainResult = SMT_ONE_LEAF

interface IAttestation {
    attesterId: BigInt;
    posRep: BigInt;
    negRep: BigInt;
    graffiti: BigInt;
    overwriteGraffiti: boolean;
}

class Attestation implements IAttestation {
    public attesterId: BigInt
    public posRep: BigInt
    public negRep: BigInt
    public graffiti: BigInt
    public overwriteGraffiti: boolean

    constructor(
        _attesterId: BigInt,
        _posRep: BigInt,
        _negRep: BigInt,
        _graffiti: BigInt,
        _overwriteGraffiti: boolean,
    ) {
        this.attesterId = _attesterId
        this.posRep = _posRep
        this.negRep = _negRep
        this.graffiti = _graffiti
        this.overwriteGraffiti = _overwriteGraffiti
    }

    public hash = (): BigInt => {
        return hash5([
            this.attesterId,
            this.posRep,
            this.negRep,
            this.graffiti,
            BigInt(this.overwriteGraffiti),
        ])
    }

    public toJSON = (space = 0): string => {
        return JSON.stringify(
            {
                attesterId: this.attesterId.toString(),
                posRep: this.posRep.toString(),
                negRep: this.negRep.toString(),
                graffiti: this.graffiti.toString(),
                overwriteGraffiti: this.overwriteGraffiti
            },
            null,
            space
        )
    }
}

class UnirepState {
    public globalStateTreeDepth: number
    public userStateTreeDepth: number
    public epochTreeDepth: number
    public nullifierTreeDepth: number
    
    public attestingFee: ethers.BigNumber
    public epochLength: number
    public maxEpochKeyNonce: number
    public maxAttestationsPerEpochKey: number
    
    public currentEpoch: number
    public defaultGSTLeaf: BigInt
    private GSTLeaves: {[key: number]: BigInt[]} = {}
    private epochTreeLeaves: {[key: number]: IEpochTreeLeaf[]} = {}
    private nullifiers: BigInt[] = []

    private epochKeyToHashchainMap: {[key: string]: BigInt} = {}
    private epochKeyToAttestationsMap: {[key: string]: IAttestation[]} = {}

    constructor(
        _globalStateTreeDepth: number,
        _userStateTreeDepth: number,
        _epochTreeDepth: number,
        _nullifierTreeDepth: number,
        _attestingFee: ethers.BigNumber,
        _epochLength: number,
        _maxNonce: number,
        _maxAttestationsPerEpochKey: number,
    ) {

        this.globalStateTreeDepth = _globalStateTreeDepth
        this.userStateTreeDepth = _userStateTreeDepth
        this.epochTreeDepth = _epochTreeDepth
        this.nullifierTreeDepth =_nullifierTreeDepth
        this.attestingFee = _attestingFee
        this.epochLength = _epochLength
        this.maxEpochKeyNonce = _maxNonce
        this.maxAttestationsPerEpochKey = _maxAttestationsPerEpochKey

        this.currentEpoch = 1
        this.GSTLeaves[this.currentEpoch] = []
        const emptyUserStateRoot = computeEmptyUserStateRoot(_userStateTreeDepth)
        this.defaultGSTLeaf = hashLeftRight(
            BigInt(0),  // zero identityCommitment
            emptyUserStateRoot,  // zero user state root
        )
    }

    /*
     * Get the hash chain result of given epoch key
     */
    public getHashchain = (epochKey: string): BigInt => {
        const hashchain = this.epochKeyToHashchainMap[epochKey]
        if (!hashchain) return DefaultHashchainResult
        else return hashchain
    }

    /*
     * Get the attestations of given epoch key
     */
    public getAttestations = (epochKey: string): IAttestation[] => {
        const attestations = this.epochKeyToAttestationsMap[epochKey]
        if (!attestations) return []
        else return attestations
    }


    /*
     * Add a new attestation to the list of attestations to the epoch key.
     */
    public addAttestation = (
        epochKey: string,
        attestation: IAttestation,
    ) => {
        const attestations = this.epochKeyToAttestationsMap[epochKey]
        if (!attestations) this.epochKeyToAttestationsMap[epochKey] = []
        this.epochKeyToAttestationsMap[epochKey].push(attestation)
    }

    /*
     * Computes the global state tree of given epoch
     */
    public genGSTree = (epoch: number): IncrementalQuinTree => {
        const GSTree = new IncrementalQuinTree(
            this.globalStateTreeDepth,
            this.defaultGSTLeaf,
            2,
        )

        const leaves = this.GSTLeaves[epoch]
        if (!leaves) return GSTree
        else {
            for (const leaf of leaves) {
                GSTree.insert(leaf)
            }
            return GSTree
        }
    }

    /*
     * Computes the epoch tree of given epoch
     */
    public genEpochTree = async (epoch: number): Promise<SparseMerkleTreeImpl> => {
        const epochTree = await genNewSMT(this.epochTreeDepth, SMT_ONE_LEAF)

        const leaves = this.epochTreeLeaves[epoch]
        if (!leaves) return epochTree
        else {
            for (const leaf of leaves) {
                await epochTree.update(leaf.epochKey, leaf.hashchainResult)
            }
            return epochTree
        }
    }

    /*
     * Computes the epoch tree of given epoch
     */
    public genNullifierTree = async (): Promise<SparseMerkleTreeImpl> => {
        const nullifierTree = await genNewSMT(this.nullifierTreeDepth, SMT_ZERO_LEAF)
        // Reserve leaf 0
        await nullifierTree.update(BigInt(0), SMT_ONE_LEAF)

        const leaves = this.nullifiers
        if (leaves.length == 0) return nullifierTree
        else {
            for (const leaf of leaves) {
                await nullifierTree.update(leaf, SMT_ONE_LEAF)
            }
            return nullifierTree
        }
    }


    /*
     * Add a new state leaf to the list of GST leaves of given epoch.
     */
    public signUp = (
        epoch: number,
        GSTLeaf: BigInt,
    ) => {
        // assert(epoch >= 1, `Epoch(${epoch}) must be greater or equal to one`)
        assert(epoch == this.currentEpoch, `Epoch(${epoch}) must be the same as current epoch`)

        // Note that we do not insert a state leaf to any state tree here. This
        // is because we want to keep the state minimal, and only compute what
        // is necessary when it is needed. This may change if we run into
        // severe performance issues, but it is currently worth the tradeoff.
        this.GSTLeaves[epoch].push(GSTLeaf)
    }

    /*
     * Add the leaves of epoch tree of given epoch and increment current epoch number
     */
    public epochTransition = (
        epoch: number,
        epochTreeLeaves: IEpochTreeLeaf[],
    ) => {
        assert(epoch == this.currentEpoch, `Epoch(${epoch}) must be the same as current epoch`)

        // Add to epoch key hash chain map
        for (let leaf of epochTreeLeaves) {
            if (this.epochKeyToHashchainMap[leaf.epochKey.toString()] !== undefined) console.log(`This epoch key(${leaf.epochKey}) seen before`)
            else this.epochKeyToHashchainMap[leaf.epochKey.toString()] = leaf.hashchainResult
        }
        this.epochTreeLeaves[epoch] = epochTreeLeaves.slice()
        this.currentEpoch ++
        this.GSTLeaves[this.currentEpoch] = []
    }

    /*
     * Add a new state leaf to the list of GST leaves of given epoch.
     */
    public userStateTransition = (
        epoch: number,
        GSTLeaf: BigInt,
        nullifiers: BigInt[],
    ) => {
        // assert(epoch >= 1, `Epoch(${epoch}) must be greater or equal to one`)
        assert(epoch == this.currentEpoch, `Epoch(${epoch}) must be the same as current epoch`)

        this.GSTLeaves[epoch].push(GSTLeaf)
        for (let nullifier of nullifiers) {
            if (nullifier > BigInt(0)) assert(this.nullifiers.indexOf(nullifier) == -1, `Nullifier(${nullifier}) seen before`)
            this.nullifiers.push(nullifier)
        }
    }
}

export {
    Attestation,
    IAttestation,
    IEpochTreeLeaf,
    UnirepState,
}