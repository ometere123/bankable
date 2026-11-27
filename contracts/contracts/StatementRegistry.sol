// SPDX-License-Identifier: MIT
pragma solidity 0.8.20;

/// @title StatementRegistry
/// @notice Non-upgradeable, no admin, no custody, no payable functions. It stores a wallet's own assertion
///         that a specific file hash is its statement for a specific block range. It certifies no financial fact.
contract StatementRegistry {
    struct Record {
        address owner;
        uint64 startUnix;
        uint64 endUnix;
        uint64 fromBlock;
        uint64 toBlock;
        uint64 registeredBlock;
        uint64 revokedBlock; // 0 = active
        bytes32 requestId;
        bytes32 issuanceSalt;
        bytes32 dataHash;
        bytes32 pdfHash;
        bytes32 rendererId;
    }

    mapping(bytes32 => Record) private records;

    event StatementRegistered(
        bytes32 indexed id,
        address indexed owner,
        bytes32 indexed requestId,
        bytes32 dataHash,
        bytes32 pdfHash,
        uint64 fromBlock,
        uint64 toBlock
    );
    event StatementRevoked(bytes32 indexed id, address indexed owner, uint64 revokedBlock);

    error ZeroCommitment();
    error BadBlockRange();
    error BadPeriod();
    error DuplicateRecord();
    error UnknownRecord();
    error NotOwner();
    error AlreadyRevoked();

    /// @return id keccak256(abi.encode(owner, pdfHash)); owner is msg.sender, so no signature is needed.
    function register(
        uint64 startUnix,
        uint64 endUnix,
        uint64 fromBlock,
        uint64 toBlock,
        bytes32 requestId,
        bytes32 issuanceSalt,
        bytes32 dataHash,
        bytes32 pdfHash,
        bytes32 rendererId
    ) external returns (bytes32 id) {
        if (
            requestId == bytes32(0) || issuanceSalt == bytes32(0) || dataHash == bytes32(0) ||
            pdfHash == bytes32(0) || rendererId == bytes32(0)
        ) revert ZeroCommitment();
        if (fromBlock == 0 || fromBlock > toBlock || toBlock >= block.number) revert BadBlockRange();
        if (startUnix >= endUnix || endUnix > block.timestamp) revert BadPeriod();

        id = keccak256(abi.encode(msg.sender, pdfHash));
        if (records[id].owner != address(0)) revert DuplicateRecord();

        records[id] = Record({
            owner: msg.sender,
            startUnix: startUnix,
            endUnix: endUnix,
            fromBlock: fromBlock,
            toBlock: toBlock,
            registeredBlock: uint64(block.number),
            revokedBlock: 0,
            requestId: requestId,
            issuanceSalt: issuanceSalt,
            dataHash: dataHash,
            pdfHash: pdfHash,
            rendererId: rendererId
        });
        emit StatementRegistered(id, msg.sender, requestId, dataHash, pdfHash, fromBlock, toBlock);
    }

    /// @notice Record owner only, one-way. A revoked record is never reactivated.
    function revoke(bytes32 id) external {
        Record storage r = records[id];
        if (r.owner == address(0)) revert UnknownRecord();
        if (r.owner != msg.sender) revert NotOwner();
        if (r.revokedBlock != 0) revert AlreadyRevoked();
        r.revokedBlock = uint64(block.number);
        emit StatementRevoked(id, msg.sender, uint64(block.number));
    }

    /// @dev Existence means owner != address(0).
    function getRecord(bytes32 id) external view returns (Record memory) {
        return records[id];
    }
}
