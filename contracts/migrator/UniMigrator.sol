// SPDX-License-Identifier: GPL-3.0

pragma solidity ^0.8.7;

import "@openzeppelin/contracts/token/ERC20/ERC20.sol";
import "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";

import "../interfaces/ILiquidityGauge.sol";
import "../interfaces/IGUniRouter.sol";
import "../interfaces/IGUniFactory.sol";
import "../interfaces/IGUniPool.sol";

/// @title GUNIMigrator
/// @author Angle Core Team
/// @notice Swaps G-UNI liquidity
contract GUNIMigrator {
    using SafeERC20 for IERC20;
    address public owner;
    address public constant AGEUR = 0x1a7e4e63778B4f12a199C062f3eFdD288afCBce8;
    address public constant USDC = 0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48;
    address public constant WETH = 0xC02aaA39b223FE8D0A0e5C4F27eAD9083C756Cc2;
    IGUniRouter public constant GUNIROUTER = IGUniRouter(0x513E0a261af2D33B46F98b81FED547608fA2a03d);
    IGUniFactory public constant GUNIFACTORY = IGUniFactory(0xEA1aFf9dbFfD1580F6b81A3ad3589E66652dB7D9);
    address public constant USDCGAUGE = 0xEB7547a8a734b6fdDBB8Ce0C314a9E6485100a3C;
    address public constant ETHGAUGE = 0x3785Ce82be62a342052b9E5431e9D3a839cfB581;
    address public ethGUNIPool;

    /// @notice Constructs a new CompSaver token
    constructor() {
        owner = msg.sender;
    }

    modifier onlyOwner() {
        require(msg.sender == owner, "wrong caller");
        _;

    }

    /// @notice Changes the minter address
    /// @param owner_ Address of the new owner
    function setOwner(address owner_) external onlyOwner {
        require(owner_ != address(0), "0 address");
        owner = owner_;
    }

    /// @return poolCreated The address of the pool created for the swap
    function migratePool(uint256 proportionSwapped, uint256 amountAgEURMin, uint256 amountTokenMin) external onlyOwner returns (address poolCreated) {
        address liquidityGauge = proportionSwapped == 10**9 ? USDCGAUGE : ETHGAUGE;
        ILiquidityGauge(liquidityGauge).accept_transfer_ownership();
        address stakingToken = ILiquidityGauge(liquidityGauge).staking_token();
        uint256 amountSwapped = IERC20(stakingToken).balanceOf(liquidityGauge) * proportionSwapped/10**9;
        ILiquidityGauge(liquidityGauge).recover_erc20(stakingToken, address(this), amountSwapped);
        IERC20(stakingToken).safeApprove(address(GUNIROUTER), type(uint256).max);
        uint256 amountAgEUR;
        uint256 amountToken;
        (amountAgEUR, amountToken,) = GUNIROUTER.removeLiquidity(stakingToken, amountSwapped, amountAgEURMin, amountTokenMin, address(this));
        if (proportionSwapped == 10**9) {
            // In this case, it's USDC
            poolCreated = GUNIFACTORY.createManagedPool(AGEUR, USDC, 100, 0, -276320, -273470);
        } else {
            // In this other case it's wETH
            poolCreated = GUNIFACTORY.createManagedPool(AGEUR, WETH, 500, 0, -96120, -69000);
        }
        IGUniPool(poolCreated).transferOwnership(0xe02F8E39b8cFA7d3b62307E46077669010883459);
        (uint256 newGUNIBalance,,) = GUNIROUTER.addLiquidity(poolCreated, amountAgEUR, amountToken, amountAgEUR, amountToken, liquidityGauge);
        ILiquidityGauge(liquidityGauge).set_staking_token_and_scaling(poolCreated, amountSwapped * 10**18 / newGUNIBalance);
        if (proportionSwapped == 10**9) {
            ILiquidityGauge(liquidityGauge).commit_transfer_ownership(0xdC4e6DFe07EFCa50a197DF15D9200883eF4Eb1c8);
        } else {
            ethGUNIPool = poolCreated;
        }
    }

    function finishPoolMigration(uint256 amountAgEURMin, uint256 amountETHMin) external onlyOwner {
        address stakingToken = ILiquidityGauge(ETHGAUGE).staking_token();
        uint256 amountRecoverable = IERC20(stakingToken).balanceOf(ETHGAUGE);
        ILiquidityGauge(ETHGAUGE).recover_erc20(stakingToken, address(this), amountRecoverable);
        uint256 amountAgEUR;
        uint256 amountToken;
        (amountAgEUR, amountToken,) = GUNIROUTER.removeLiquidity(stakingToken, amountRecoverable, amountAgEURMin, amountETHMin, address(this));
        GUNIROUTER.addLiquidity(ethGUNIPool, amountAgEUR, amountToken, amountAgEURMin, amountETHMin, ETHGAUGE);
        ILiquidityGauge(ETHGAUGE).commit_transfer_ownership(0xdC4e6DFe07EFCa50a197DF15D9200883eF4Eb1c8);
        IERC20(AGEUR).safeTransfer(0xdC4e6DFe07EFCa50a197DF15D9200883eF4Eb1c8, IERC20(AGEUR).balanceOf(address(this)));
        IERC20(WETH).safeTransfer(0xdC4e6DFe07EFCa50a197DF15D9200883eF4Eb1c8, IERC20(WETH).balanceOf(address(this)));
    }

    /// @notice Executes a function
	/// @param to Address to sent the value to
	/// @param value Value to be sent
	/// @param data Call function data
	function execute(
		address to,
		uint256 value,
		bytes calldata data
	) external onlyOwner returns (bool, bytes memory) {
        //solhint-disable-next-line
		(bool success, bytes memory result) = to.call{ value: value }(data);
		return (success, result);
	}


}