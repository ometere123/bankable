// SPDX-License-Identifier: MIT
pragma solidity 0.8.20;

import {StatementRegistry} from "../StatementRegistry.sol";

/// @notice PROBE ONLY, never deployed. Run via eth_call of the creation bytecode on QIE mainnet to execute the registry's
///         logic on the real EVM without funds. The constructor returns ABI-encoded observations instead of runtime code.
contract G3Harness {
    StatementRegistry private reg;

    function _try(uint64 s, uint64 e, uint64 f, uint64 t, bytes32 req, bytes32 salt, bytes32 pdf) private returns (bool ok) {
        (ok, ) = address(reg).call(abi.encodeCall(StatementRegistry.register, (s, e, f, t, req, salt, bytes32(uint256(3)), pdf, bytes32(uint256(5)))));
    }

    constructor() {
        reg = new StatementRegistry();
        uint64 bn = uint64(block.number);
        uint64 ts = uint64(block.timestamp);
        bytes32 pdf = bytes32(uint256(4));
        bytes32 one = bytes32(uint256(1));
        bytes32 two = bytes32(uint256(2));
        bool[13] memory r;

        bytes32 id = reg.register(ts - 1000, ts - 10, bn - 20, bn - 5, one, two, bytes32(uint256(3)), pdf, bytes32(uint256(5)));
        StatementRegistry.Record memory rec = reg.getRecord(id);
        r[0] = id == keccak256(abi.encode(address(this), pdf));
        r[1] = rec.owner == address(this);
        r[2] = rec.registeredBlock == bn;
        r[3] = rec.revokedBlock == 0;

        r[4] = !_try(ts - 1000, ts - 10, bn - 20, bn - 5, bytes32(0), two, bytes32(uint256(9)));   // zero commitment
        r[5] = !_try(ts - 1000, ts - 10, bn - 20, bn, one, two, bytes32(uint256(9)));              // toBlock == executing block
        r[6] = !_try(ts - 1000, ts + 100000, bn - 20, bn - 5, one, two, bytes32(uint256(9)));      // end in the future
        r[7] = !_try(ts - 1000, ts - 10, bn - 20, bn - 5, one, bytes32(uint256(7)), pdf);          // duplicate id

        reg.revoke(id);
        StatementRegistry.Record memory rec2 = reg.getRecord(id);
        r[8] = rec2.revokedBlock == bn;
        r[9] = rec2.pdfHash == pdf;
        (bool again, ) = address(reg).call(abi.encodeCall(StatementRegistry.revoke, (id)));
        (bool unk, ) = address(reg).call(abi.encodeCall(StatementRegistry.revoke, (bytes32(uint256(999)))));
        r[10] = !again;
        r[11] = !unk;
        r[12] = reg.getRecord(bytes32(uint256(999))).owner == address(0);

        bytes memory out = abi.encode(r);
        assembly { return(add(out, 32), mload(out)) }
    }
}
