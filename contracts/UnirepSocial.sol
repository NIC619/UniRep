pragma abicoder v2;
pragma solidity 0.7.6;

import "@openzeppelin/contracts/cryptography/ECDSA.sol";
import "@openzeppelin/contracts/math/SafeMath.sol";
import "@openzeppelin/contracts/utils/Address.sol";
import { Unirep } from './Unirep.sol';

contract UnirepSocial {
    using SafeMath for uint256;

    Unirep public unirep;

    enum actionChoices { UpVote, DownVote, Post, Comment }

    // The amount of karma required to publish a post
    uint256 immutable public postReputation;

    // The amount of karma required to submit a comment 
    uint256 immutable public commentReputation;

    // The amount of karma airdropped to user when user signs up and executes user state transition
    uint256 immutable public airdroppedReputation;

    // Indicate if the reputation nullifiers is submitted
    mapping(uint256 => bool) public isReputationNullifierSubmitted;

    // Unirep Social Events
    event Sequencer(
        string _event
    );

    // help Unirep Social track event
    event UserSignedUp(
        uint256 indexed _epoch,
        uint256 _leafIndex
    );

    event PostSubmitted(
        uint256 indexed _epoch,
        uint256 indexed _postId,
        uint256 indexed _epochKey,
        string _hahsedContent,
        uint256[] publicSignals,
        uint256[8] proof
    );

    event CommentSubmitted(
        uint256 indexed _epoch,
        uint256 indexed _commentId,
        uint256 indexed _epochKey,
        uint256 _postId,
        string _hahsedContent,
        uint256[] publicSignals,
        uint256[8] proof
    );

    event VoteSubmitted(
        uint256 indexed _epoch,
        uint256 indexed _fromEpochKey,
        uint256 indexed _toEpochKey,
        Unirep.Attestation attestation,
        uint256[] publicSignals,
        uint256[8] proof
    );

    event ReputationNullifierSubmitted(
        uint256 indexed _epoch,
        uint256 spendReputationAmount,
        uint256[] reputationNullifiers
    );


    constructor(
        Unirep _unirepContract,
        uint256 _postReputation,
        uint256 _commentReputation,
        uint256 _airdroppedReputation
    ) {
        // Set the unirep contracts
        unirep = _unirepContract;

        postReputation = _postReputation;
        commentReputation = _commentReputation;
        airdroppedReputation = _airdroppedReputation;
    }

    /*
     * Call Unirep contract to perform user signing up
     * @param _identityCommitment Commitment of the user's identity which is a semaphore identity.
     */
    function userSignUp(uint256 _identityCommitment) external {
        unirep.userSignUp(_identityCommitment, airdroppedReputation);

        emit UserSignedUp(
            unirep.currentEpoch(),
            unirep.nextGSTLeafIndex() - 1
        );
    }

    function attesterSignUp(bytes calldata signature) external {
        unirep.attesterSignUpViaRelayer(msg.sender, signature);
    }

    function spendReputation(
        bytes memory signature,
        uint256 epochKey,
        uint256[] memory publicSignals,
        uint256[8] memory _proof,
        uint256 spendReputationAmount
    ) public payable {
        // Determine if repuataion nullifiers are submitted before
        // The first spendRepuatationAmount of public signals are valid repuation nullifiers
        uint256[] memory reputationNullifiers = new uint256[](spendReputationAmount);
        for (uint i = 0; i < spendReputationAmount; i++) {
            require(isReputationNullifierSubmitted[publicSignals[i]] == false, "Unirep Social: the nullifier has been submitted");
            isReputationNullifierSubmitted[publicSignals[i]] = true;
            reputationNullifiers[i] = publicSignals[i];
        }

        bool proofIsValid = unirep.verifyReputation(publicSignals, _proof);
        require(proofIsValid, "Unirep Social: the proof is not valid");

        // Verify epoch key and its proof
        // Then submit negative attestation to this epoch key
        Unirep.Attestation memory attestation;
        attestation.attesterId = unirep.attesters(msg.sender);
        attestation.posRep = 0;
        attestation.negRep = spendReputationAmount;
        attestation.graffiti = 0;
        attestation.overwriteGraffiti = false;
        unirep.submitAttestationViaRelayer{value: unirep.attestingFee()}(msg.sender, signature, attestation, epochKey);

        emit Sequencer("ReputationNullifierSubmitted");
        emit ReputationNullifierSubmitted(
            unirep.currentEpoch(),
            spendReputationAmount,
            reputationNullifiers
        );
    }

    function publishPost(
        bytes calldata signature,
        uint256 postId, 
        uint256 epochKey, 
        string calldata hashedContent, 
        uint256[] calldata publicSignals, 
        uint256[8] calldata proof) external payable {

        // Call Unirep contract to perform reputation spending
        spendReputation(signature, epochKey, publicSignals, proof, postReputation);
        
        emit PostSubmitted(
            unirep.currentEpoch(),
            postId,
            epochKey,
            hashedContent,
            publicSignals,
            proof
        );
    }

    function leaveComment(
        bytes calldata signature,
        uint256 postId, 
        uint256 commentId,
        uint256 epochKey, 
        string calldata hashedContent, 
        uint256[] calldata publicSignals, 
        uint256[8] calldata proof) external payable {

        // Call Unirep contract to perform reputation spending
        spendReputation(signature, epochKey, publicSignals, proof, commentReputation);
    
        emit CommentSubmitted(
            unirep.currentEpoch(),
            commentId,
            epochKey,
            postId,
            hashedContent,
            publicSignals,
            proof
        );
    }

    function vote(
        bytes memory signature,
        Unirep.Attestation memory attestation,
        uint256 toEpochKey,
        uint256 fromEpochKey,
        uint256[] memory publicSignals, 
        uint256[8] memory proof ) public payable {
        uint256 voteValue = attestation.posRep + attestation.negRep;
        require(voteValue > 0, "Unirep Social: should submit a positive vote value");
        require(attestation.posRep * attestation.negRep == 0, "Unirep Social: should only choose to upvote or to downvote");

        // Spend attester's reputation
        // Call Unirep contract to perform reputation spending
        spendReputation(signature, fromEpochKey, publicSignals, proof, voteValue);

        // Send Reputation to others
        unirep.submitAttestationViaRelayer{value: unirep.attestingFee()}(msg.sender, signature, attestation, toEpochKey);

        emit VoteSubmitted(
            unirep.currentEpoch(),
            fromEpochKey, 
            toEpochKey, 
            attestation, 
            publicSignals, 
            proof
        );
    }

    function beginEpochTransition(uint256 numEpochKeysToSeal) external {
        unirep.beginEpochTransition(numEpochKeysToSeal);
    }

    function updateUserStateRoot(
        uint256 _newGlobalStateTreeLeaf,
        uint256[] memory _attestationNullifiers,
        uint256[] memory _epkNullifiers,
        uint256 _transitionFromEpoch,
        uint256 _fromGlobalStateTree,
        uint256 _fromEpochTree,
        uint256 _fromNullifierTreeRoot,
        uint256[8] memory _proof) external {
        unirep.updateUserStateRoot(_newGlobalStateTreeLeaf, _attestationNullifiers, _epkNullifiers, _transitionFromEpoch, _fromGlobalStateTree, _fromEpochTree, _fromNullifierTreeRoot, _proof);

    }


    function verifyEpochKeyValidity(
        uint256[] memory _publicSignals,
        uint256[8] memory _proof) public view returns (bool) {
        return unirep.verifyEpochKeyValidity(_publicSignals, _proof);
    }

    function verifyUserStateTransition(
        uint256 _newGlobalStateTreeLeaf,
        uint256[] memory _attestationNullifiers,
        uint256[] memory _epkNullifiers,
        uint256 _transitionFromEpoch,
        uint256 _fromGlobalStateTree,
        uint256 _fromEpochTree,
        uint256[8] memory _proof) public view returns (bool) {
        return unirep.verifyUserStateTransition(_newGlobalStateTreeLeaf, _attestationNullifiers, _epkNullifiers, _transitionFromEpoch, airdroppedReputation, _fromGlobalStateTree, _fromEpochTree, _proof);
    }

    function verifyReputation(
        uint256[] memory _publicSignals,
        uint256[8] memory _proof) public view returns (bool) {
        return unirep.verifyReputation(_publicSignals, _proof);
    }

    function verifyReputationFromAttester(
        uint256[] memory _publicSignals,
        uint256[8] memory _proof) public view returns (bool) {
        return unirep.verifyReputationFromAttester(_publicSignals, _proof);
    }

    function min(uint a, uint b) internal pure returns (uint) {
        if (a > b) {
            return b;
        } else {
            return a;
        }
    }

    function hashedBlankStateLeaf() public view returns (uint256) {
        return unirep.hashedBlankStateLeaf();
    }

    function getEpochTreeLeaves(uint256 epoch) external view returns (uint256[] memory epochKeyList, uint256[] memory epochKeyHashChainList) {
        return unirep.getEpochTreeLeaves(epoch);
    }

    /*
     * Functions to burn fee and collect compenstation.
     */
    function burnAttestingFee() external {
        unirep.burnAttestingFee();
    }

    function collectEpochTransitionCompensation() external {
        unirep.collectEpochTransitionCompensation();
    }
}