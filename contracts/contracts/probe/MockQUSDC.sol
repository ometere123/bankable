// SPDX-License-Identifier: MIT
pragma solidity 0.8.20;

/// @notice LOCAL TEST FIXTURE ONLY. Never deployed to a real network. Its runtime code is injected at the QUSDC address of a LOCAL
///         Hardhat node (chain id 1990) so the full Bankable flow can be exercised with real transactions. No constructor state.
contract MockQUSDC {
    mapping(address => uint256) public balanceOf;
    event Transfer(address indexed from, address indexed to, uint256 value);
    function decimals() external pure returns (uint8) { return 6; }
    function symbol() external pure returns (string memory) { return "QUSDC"; }
    function name() external pure returns (string memory) { return "QUSDC"; }
    function mint(address to, uint256 v) external { balanceOf[to] += v; emit Transfer(address(0), to, v); }
    function burn(address from, uint256 v) external { balanceOf[from] -= v; emit Transfer(from, address(0), v); }
    /// @dev test helper: anyone can move funds, so fixtures can create arbitrary history
    function move(address from, address to, uint256 v) external { balanceOf[from] -= v; balanceOf[to] += v; emit Transfer(from, to, v); }
}
