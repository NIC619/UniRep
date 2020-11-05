import assert from 'assert'
import {
    hashLeftRight,
    IncrementalQuinTree,
    hash5,
    stringifyBigInts,
    hashOne,
} from 'maci-crypto'
import { SparseMerkleTreeImpl } from '../crypto/SMT'
import { genAttestationNullifier, defaultUserStateLeaf, genEpochKey, genNewSMT, genEpochKeyNullifier } from '../test/utils'
import { IAttestation, UnirepState } from './UnirepState'

interface IUserStateLeaf {
    attesterId: BigInt;
    reputation: Reputation;
}

interface IReputation {
    posRep: BigInt;
    negRep: BigInt;
    graffiti: BigInt;
}

class Reputation implements IReputation {
    public posRep: BigInt
    public negRep: BigInt
    public graffiti: BigInt
    public graffitiPreImage: BigInt = BigInt(0)

    constructor(
        _posRep: BigInt,
        _negRep: BigInt,
        _graffiti: BigInt,
    ) {
        this.posRep = _posRep
        this.negRep = _negRep
        this.graffiti = _graffiti
    }

    public static default(): Reputation {
        return new Reputation(BigInt(0), BigInt(0), BigInt(0))
    }

    public update = (
        _posRep: BigInt,
        _negRep: BigInt,
        _graffiti: BigInt,
        _overwriteGraffiti: boolean,
    ): Reputation => {
        const newRep = new Reputation(
            _posRep,
            _negRep,
            _overwriteGraffiti ? _graffiti : this.graffiti
        )
        return newRep
    }

    public addGraffitiPreImage = (_graffitiPreImage: BigInt) => {
        assert(hashOne(this.graffitiPreImage) === this.graffiti, 'Graffiti pre-image does not match')
        this.graffitiPreImage = _graffitiPreImage
    }

    public hash = (): BigInt => {
        return hash5([
            this.posRep,
            this.negRep,
            this.graffiti,
            BigInt(0),
            BigInt(0),
        ])
    }

    public toJSON = (space = 0): string => {
        return JSON.stringify(
            {
                posRep: this.posRep.toString(),
                negRep: this.negRep.toString(),
                graffiti: this.graffiti.toString(),
                graffitiPreImage: this.graffitiPreImage.toString()
            },
            null,
            space
        )
    }
}

class UserState {
    public userStateTreeDepth: number
    public numEpochKeyNoncePerEpoch: number
    public numAttestationsPerEpochKey: number

    private unirepState: UnirepState

    public id
    public commitment
    private hasSignedUp: boolean = false

    public latestTransitionedEpoch: number  // Latest epoch where the user has a record in the GST of that epoch
    public latestGSTLeafIndex: number  // Leaf index of the latest GST where the user has a record in
    private latestUserStateLeaves: IUserStateLeaf[]  // Latest non-default user state leaves

    constructor(
        _unirepState: UnirepState,
        _id,
        _commitment,
        _hasSignedUp: boolean,
        _latestTransitionedEpoch?: number,
        _latestGSTLeafIndex?: number,
        _latestUserStateLeaves?: IUserStateLeaf[],
    ) {
        assert(_unirepState !== undefined, "UnirepState is undefined")
        this.unirepState = _unirepState
        this.userStateTreeDepth = this.unirepState.userStateTreeDepth
        this.numEpochKeyNoncePerEpoch = this.unirepState.numEpochKeyNoncePerEpoch
        this.numAttestationsPerEpochKey = this.unirepState.numAttestationsPerEpochKey

        this.id = _id
        this.commitment = _commitment
        if (_hasSignedUp) {
            assert(_latestTransitionedEpoch !== undefined, "User has signed up but missing latestTransitionedEpoch")
            assert(_latestGSTLeafIndex !== undefined, "User has signed up but missing latestTransitionedEpoch")

            this.latestTransitionedEpoch = _latestTransitionedEpoch
            this.latestGSTLeafIndex = _latestGSTLeafIndex
            if (_latestUserStateLeaves !== undefined) this.latestUserStateLeaves = _latestUserStateLeaves
            else this.latestUserStateLeaves = []
            this.hasSignedUp = _hasSignedUp
        } else {
            this.latestTransitionedEpoch = 0
            this.latestGSTLeafIndex = 0
            this.latestUserStateLeaves = []
        }
    }

    public toJSON = (space = 0): string => {
        return JSON.stringify(
            {
                idNullifier: this.id.identityNullifier.toString(),
                idCommitment: this.commitment.toString(),
                hasSignedUp: this.hasSignedUp,
                latestTransitionedEpoch: this.latestTransitionedEpoch,
                latestGSTLeafIndex: this.latestGSTLeafIndex,
                latestUserStateLeaves: this.latestUserStateLeaves.map((l) => `${l.attesterId.toString()}: ${l.reputation.toJSON()}`),
                unirepState: this.unirepState.toJSON()
            },
            null,
            space
        )
    }
    
    /*
     * Proxy methods to get underlying UnirepState data
     */
    public getUnirepStateCurrentEpoch = (): number => {
        return this.unirepState.currentEpoch
    }

    public getUnirepStateGSTree = (epoch: number): IncrementalQuinTree => {
        return this.unirepState.genGSTree(epoch)
    }

    public getUnirepStateEpochTree = async (epoch: number): Promise<SparseMerkleTreeImpl> => {
        return this.unirepState.genEpochTree(epoch)
    }

    public getUnirepStateNullifierTree = async (): Promise<SparseMerkleTreeImpl> => {
        return this.unirepState.genNullifierTree()
    }

    /*
     * Get the attestations of given epoch key
     */
    public getAttestations = (epochKey: string): IAttestation[] => {
        return this.unirepState.getAttestations(epochKey)
    }

    /*
     * Get the nullifier of the attestations of given epoch
     */
    public getAttestationNullifiers = (epoch: number): BigInt[] => {
        const nullifiers: BigInt[] = []
        for (let nonce = 0; nonce < this.numEpochKeyNoncePerEpoch; nonce++) {
            const epochKey = genEpochKey(this.id.identityNullifier, epoch, nonce, this.unirepState.epochTreeDepth)
            const attestations = this.unirepState.getAttestations(epochKey.toString())
            for (const attestation of attestations) {
                nullifiers.push(
                    genAttestationNullifier(this.id.identityNullifier, attestation.attesterId, epoch, epochKey, this.unirepState.nullifierTreeDepth)
                )
            }
            for (let i = 0; i < (this.numAttestationsPerEpochKey - attestations.length); i++) {
                nullifiers.push(BigInt(0))
            }
        }
        return nullifiers
    }

    /*
     * Get the epoch key nullifier of given epoch
     */
    public getEpochKeyNullifiers = (epoch: number): BigInt[] => {
        const nullifiers: BigInt[] = []
        for (let nonce = 0; nonce < this.numEpochKeyNoncePerEpoch; nonce++) {
            const nullifier = genEpochKeyNullifier(this.id.identityNullifier, epoch, nonce, this.unirepState.nullifierTreeDepth)
            nullifiers.push(nullifier)
        }
        return nullifiers
    }

    public getRepByAttester = (attesterId: BigInt): Reputation => {
        const leaf = this.latestUserStateLeaves.find((leaf) => leaf.attesterId == attesterId)
        if (leaf !== undefined) return leaf.reputation
        else return Reputation.default()
    }

    /*
     * Add a new epoch key to the list of epoch key of current epoch.
     */
    public signUp = (_latestTransitionedEpoch: number, _latestGSTLeafIndex: number,) => {
        assert(!this.hasSignedUp, "User has already signed up")
        this.latestTransitionedEpoch = _latestTransitionedEpoch
        this.latestGSTLeafIndex = _latestGSTLeafIndex
        this.hasSignedUp = true
    }

    /*
     * Computes the user state tree with given state leaves
     */
    private _genUserStateTreeFromLeaves = async (leaves: IUserStateLeaf[]): Promise<SparseMerkleTreeImpl> => {
        const USTree = await genNewSMT(this.userStateTreeDepth, defaultUserStateLeaf)

        for (const leaf of leaves) {
            await USTree.update(leaf.attesterId, leaf.reputation.hash())
        }
        return USTree
    }

    /*
     * Computes the user state tree of given epoch
     */
    public genUserStateTree = async (): Promise<SparseMerkleTreeImpl> => {
        const leaves = this.latestUserStateLeaves
        return (await this._genUserStateTreeFromLeaves(leaves))
    }


    public genVerifyEpochKeyCircuitInputs = async (
        epochKeyNonce: number,
    ) => {
        assert(this.hasSignedUp, "User has not signed up yet")
        assert(epochKeyNonce < this.numEpochKeyNoncePerEpoch, `epochKeyNonce(${epochKeyNonce}) must be less than max epoch nonce`)
        const epoch = this.latestTransitionedEpoch
        const epochKey = genEpochKey(this.id.identityNullifier, epoch, epochKeyNonce, this.unirepState.epochTreeDepth)

        const GSTree = this.unirepState.genGSTree(epoch)
        const GSTProof = GSTree.genMerklePath(this.latestGSTLeafIndex)

        return stringifyBigInts({
            identity_pk: this.id.keypair.pubKey,
            identity_nullifier: this.id.identityNullifier, 
            identity_trapdoor: this.id.identityTrapdoor,
            user_state_root: (await this.genUserStateTree()).getRootHash(),
            path_elements: GSTProof.pathElements,
            path_index: GSTProof.indices,
            root: GSTree.root,
            nonce: epochKeyNonce,
            epoch: epoch,
            epoch_key: epochKey,
        })
    }

    private _updateUserStateLeaf = (attestation: IAttestation, stateLeaves: IUserStateLeaf[]): IUserStateLeaf[] => {
        const attesterId = attestation.attesterId
        for (const leaf of stateLeaves) {
            if (leaf.attesterId === attesterId) {
                leaf.reputation = leaf.reputation.update(
                    attestation.posRep,
                    attestation.negRep,
                    attestation.graffiti,
                    attestation.overwriteGraffiti
                )
            }
            return stateLeaves
        }
        // If no matching state leaf, insert new one
        const newLeaf: IUserStateLeaf = {
            attesterId: attesterId,
            reputation: Reputation.default().update(attestation.posRep, attestation.negRep, attestation.graffiti, attestation.overwriteGraffiti)
        }
        stateLeaves.push(newLeaf)
        return stateLeaves
    }

    public genNewUserStateAfterTransition = async () => {
        assert(this.hasSignedUp, "User has not signed up yet")
        const fromEpoch = this.latestTransitionedEpoch

        let stateLeaves: IUserStateLeaf[]
        stateLeaves = this.latestUserStateLeaves.slice()

        for (let nonce = 0; nonce < this.numEpochKeyNoncePerEpoch; nonce++) {
            const epkNullifier = genEpochKeyNullifier(this.id.identityNullifier, fromEpoch, nonce, this.unirepState.nullifierTreeDepth)
            assert(! this.unirepState.nullifierExist(epkNullifier), `Epoch key with nonce ${nonce} is already processed, it's nullifier: ${epkNullifier}`)

            const epochKey = genEpochKey(this.id.identityNullifier, fromEpoch, nonce, this.unirepState.epochTreeDepth)
            const attestations = this.unirepState.getAttestations(epochKey.toString())
            for (let i = 0; i < attestations.length; i++) {
                const attestation = attestations[i]
                stateLeaves = this._updateUserStateLeaf(attestation, stateLeaves)
            }
        }

        // Gen new user state tree
        const newUserStateTree = await this._genUserStateTreeFromLeaves(stateLeaves)
        // Gen new GST leaf
        const newGSTLeaf = hashLeftRight(this.commitment, newUserStateTree.getRootHash())

        return {
            'newGSTLeaf': newGSTLeaf,
            'newUSTLeaves': stateLeaves
        }
    }

    public genUserStateTransitionCircuitInputs = async () => {
        assert(this.hasSignedUp, "User has not signed up yet")
        const fromEpoch = this.latestTransitionedEpoch

        // User state tree
        const fromEpochUserStateTree: SparseMerkleTreeImpl = await this.genUserStateTree()
        const intermediateUserStateTreeRoots: BigInt[] = [
            fromEpochUserStateTree.getRootHash()
        ]
        const userStateLeafPathElements: any[] = []
        // GSTree
        const fromEpochGSTree: IncrementalQuinTree = this.unirepState.genGSTree(fromEpoch)
        const GSTreeProof = fromEpochGSTree.genMerklePath(this.latestGSTLeafIndex)
        const GSTreeRoot = fromEpochGSTree.root
        // Epoch tree
        const fromEpochTree = await this.unirepState.genEpochTree(fromEpoch)
        const epochTreeRoot = fromEpochTree.getRootHash()
        const epochKeyPathElements: any[] = []
        const hashChainResults: BigInt[] = []
        // Nullifier
        const nullifierTree = await this.unirepState.genNullifierTree()
        const nullifierTreeRoot = nullifierTree.getRootHash()
        const attestationNullifierPathElements: any[] = []
        const nullifiers: BigInt[] = []

        const selectors: number[] = []
        const attesterIds: BigInt[] = []
        const oldPosReps: BigInt[] = [], oldNegReps: BigInt[] = [], oldGraffities: BigInt[] = []
        const posReps: BigInt[] = [], negReps: BigInt[] = [], graffities: BigInt[] = [], overwriteGraffitis: any[] = []

        for (let nonce = 0; nonce < this.numEpochKeyNoncePerEpoch; nonce++) {
            const epochKey = genEpochKey(this.id.identityNullifier, fromEpoch, nonce, this.unirepState.epochTreeDepth)

            // Attestations
            const attestations = this.unirepState.getAttestations(epochKey.toString())
            for (let i = 0; i < attestations.length; i++) {
                const attestation = attestations[i]
                const attesterId = attestation.attesterId
                const rep = this.getRepByAttester(attesterId)
                oldPosReps.push(rep.posRep)
                oldNegReps.push(rep.negRep)
                oldGraffities.push(rep.graffiti)

                // Add UST merkle proof to the list
                const USTLeafPathElements = await fromEpochUserStateTree.getMerkleProof(attesterId)
                userStateLeafPathElements.push(USTLeafPathElements)
                const newRep = rep.update(attestation.posRep, attestation.negRep, attestation.graffiti, attestation.overwriteGraffiti)
                // Update UST
                await fromEpochUserStateTree.update(attesterId, newRep.hash())
                // Add new UST root to intermediate UST roots
                intermediateUserStateTreeRoots.push(fromEpochUserStateTree.getRootHash())
                
                selectors.push(1)
                attesterIds.push(attesterId)
                posReps.push(newRep.posRep)
                negReps.push(newRep.negRep)
                graffities.push(newRep.graffiti)
                overwriteGraffitis.push(attestation.overwriteGraffiti)

                const nullifier = genAttestationNullifier(this.id.identityNullifier, attesterId, fromEpoch, epochKey, this.unirepState.nullifierTreeDepth)
                nullifiers.push(nullifier)
                const attestationNullifierProof = await nullifierTree.getMerkleProof(nullifier)
                attestationNullifierPathElements.push(attestationNullifierProof)
            }
            // Fill in blank data for non-exist attestation
            for (let i = 0; i < (this.numAttestationsPerEpochKey - attestations.length); i++) {
                oldPosReps.push(BigInt(0))
                oldNegReps.push(BigInt(0))
                oldGraffities.push(BigInt(0))
                
                const USTLeafZeroPathElements = await fromEpochUserStateTree.getMerkleProof(BigInt(0))
                userStateLeafPathElements.push(USTLeafZeroPathElements)
                intermediateUserStateTreeRoots.push(fromEpochUserStateTree.getRootHash())

                selectors.push(0)
                attesterIds.push(BigInt(0))
                posReps.push(BigInt(0))
                negReps.push(BigInt(0))
                graffities.push(BigInt(0))
                overwriteGraffitis.push(false)
                
                nullifiers.push(BigInt(0))
                const attestationNullifierProof = await nullifierTree.getMerkleProof(BigInt(0))
                attestationNullifierPathElements.push(attestationNullifierProof)    
            }
            epochKeyPathElements.push(await fromEpochTree.getMerkleProof(epochKey))
            hashChainResults.push(this.unirepState.getHashchain(epochKey.toString()))
        }


        return stringifyBigInts({
            epoch: fromEpoch,
            intermediate_user_state_tree_roots: intermediateUserStateTreeRoots,
            old_pos_reps: oldPosReps,
            old_neg_reps: oldNegReps,
            old_graffities: oldGraffities,
            UST_path_elements: userStateLeafPathElements,
            identity_pk: this.id.keypair.pubKey,
            identity_nullifier: this.id.identityNullifier,
            identity_trapdoor: this.id.identityTrapdoor,
            GST_path_elements: GSTreeProof.pathElements,
            GST_path_index: GSTreeProof.indices,
            GST_root: GSTreeRoot,
            selectors: selectors,
            attester_ids: attesterIds,
            pos_reps: posReps,
            neg_reps: negReps,
            graffities: graffities,
            overwrite_graffitis: overwriteGraffitis,
            epk_path_elements: epochKeyPathElements,
            hash_chain_results: hashChainResults,
            epoch_tree_root: epochTreeRoot,
            nullifier_tree_root: nullifierTreeRoot,
            attestation_nullifier_path_elements: attestationNullifierPathElements
        })
    }

    /*
     * Update transition data including latest transition epoch, GST leaf index and user state tree leaves.
     */
    public transition = (
        latestStateLeaves: IUserStateLeaf[],
    ) => {
        assert(this.hasSignedUp, "User has not signed up yet")

        const fromEpoch = this.latestTransitionedEpoch
        const transitionToEpoch = this.unirepState.currentEpoch
        const transitionToGSTIndex = this.unirepState.getNumGSTLeaves(transitionToEpoch)
        assert(fromEpoch < transitionToEpoch, "Can not transition to same epoch")

        this.latestTransitionedEpoch = transitionToEpoch
        this.latestGSTLeafIndex = transitionToGSTIndex

        // Update user state leaves
        this.latestUserStateLeaves = latestStateLeaves.slice()
        console.log('user transitioned')
    }

    public genProveReputationCircuitInputs = async (
        attesterId: BigInt,
        minPosRep: BigInt,
        maxNegRep: BigInt,
        graffitiPreImage: BigInt,
    ) => {
        assert(this.hasSignedUp, "User has not signed up yet")
        assert(attesterId > BigInt(0), `attesterId must be greater than zero`)
        assert(attesterId < BigInt(2 ** this.userStateTreeDepth), `attesterId exceeds total number of attesters`)
        const rep = this.getRepByAttester(attesterId)
        const posRep = rep.posRep
        const negRep = rep.negRep
        const graffiti = rep.graffiti
        const userStateTree = await this.genUserStateTree()
        const GSTree = this.unirepState.genGSTree(this.latestTransitionedEpoch)
        const GSTreeProof = GSTree.genMerklePath(this.latestGSTLeafIndex)
        const GSTreeRoot = GSTree.root
        const pathElements = await userStateTree.getMerkleProof(attesterId)

        return stringifyBigInts({
            identity_pk: this.id.keypair.pubKey,
            identity_nullifier: this.id.identityNullifier, 
            identity_trapdoor: this.id.identityTrapdoor,
            user_state_root: userStateTree.getRootHash(),
            GST_path_index: GSTreeProof.indices,
            GST_path_elements: GSTreeProof.pathElements,
            GST_root: GSTreeRoot,
            attester_id: attesterId,
            pos_rep: posRep,
            neg_rep: negRep,
            graffiti: graffiti,
            UST_path_elements: pathElements,
            min_pos_rep: minPosRep,
            max_neg_rep: maxNegRep,
            graffiti_pre_image: graffitiPreImage
        })
    }
}

export {
    IReputation,
    IUserStateLeaf,
    Reputation,
    UserState,
}