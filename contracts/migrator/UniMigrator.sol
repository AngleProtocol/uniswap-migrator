// SPDX-License-Identifier: GPL-3.0

pragma solidity ^0.8.7;

import "@openzeppelin/contracts/token/ERC20/ERC20.sol";
import "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";

import "../interfaces/ILiquidityGauge.sol";
import "../interfaces/IGUniRouter.sol";
import "../interfaces/IGUniFactory.sol";
import "../interfaces/IGUniPool.sol";
import "../interfaces/IUniswapPool.sol";
import "../interfaces/IUniswapPositionManager.sol";

import "hardhat/console.sol";

/// @title UniMigrator
/// @author Angle Core Team
/// @notice Swaps G-UNI liquidity
contract UniMigrator {
    using SafeERC20 for IERC20;
    address public owner;
    address private constant _AGEUR = 0x1a7e4e63778B4f12a199C062f3eFdD288afCBce8;
    address private constant _USDC = 0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48;
    address private constant _WETH = 0xC02aaA39b223FE8D0A0e5C4F27eAD9083C756Cc2;
    IGUniRouter private constant _GUNIROUTER = IGUniRouter(0x513E0a261af2D33B46F98b81FED547608fA2a03d);
    IGUniFactory private constant _GUNIFACTORY = IGUniFactory(0xEA1aFf9dbFfD1580F6b81A3ad3589E66652dB7D9);
    address private constant _USDCGAUGE = 0xEB7547a8a734b6fdDBB8Ce0C314a9E6485100a3C;
    address private constant _ETHGAUGE = 0x3785Ce82be62a342052b9E5431e9D3a839cfB581;
    address private constant _GOVERNOR = 0xdC4e6DFe07EFCa50a197DF15D9200883eF4Eb1c8;
    address private constant _UNIUSDCPOOL = 0x7ED3F364668cd2b9449a8660974a26A092C64849;
    address private constant _UNIETHPOOL = 0x9496D107a4b90c7d18c703e8685167f90ac273B0;
    IUniswapPositionManager private constant _UNI = IUniswapPositionManager(0xC36442b4a4522E871399CD717aBDD847Ab11FE88);
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
    function migratePool(
        uint8 gaugeType,
        uint256 amountAgEURMin,
        uint256 amountTokenMin
    ) external onlyOwner returns (address poolCreated) {
        address liquidityGauge;
        uint256 amountSwapped;
        address stakingToken;
        uint160 sqrtPriceX96Existing;
        if (gaugeType == 1) {
            liquidityGauge = _USDCGAUGE;
            stakingToken = ILiquidityGauge(liquidityGauge).staking_token();
            amountSwapped = IERC20(stakingToken).balanceOf(liquidityGauge);
            (sqrtPriceX96Existing, , , , , , ) = IUniswapV3Pool(_UNIUSDCPOOL).slot0();
            IERC20(_USDC).safeApprove(address(_GUNIROUTER), type(uint256).max);
        } else {
            liquidityGauge = _ETHGAUGE;
            stakingToken = ILiquidityGauge(liquidityGauge).staking_token();
            amountSwapped = IERC20(stakingToken).balanceOf(liquidityGauge) / 2;
            (sqrtPriceX96Existing, , , , , , ) = IUniswapV3Pool(_UNIETHPOOL).slot0();
            IERC20(_WETH).safeApprove(address(_GUNIROUTER), type(uint256).max);
        }
        IERC20(stakingToken).safeApprove(address(_GUNIROUTER), type(uint256).max);
        IERC20(_AGEUR).safeApprove(address(_GUNIROUTER), type(uint256).max);
        ILiquidityGauge(liquidityGauge).accept_transfer_ownership();
        ILiquidityGauge(liquidityGauge).recover_erc20(stakingToken, address(this), amountSwapped);
        
        uint256 amountAgEUR;
        uint256 amountToken;
        (amountAgEUR, amountToken, ) = _GUNIROUTER.removeLiquidity(
            stakingToken,
            amountSwapped,
            amountAgEURMin,
            amountTokenMin,
            address(this)
        );
        if (gaugeType == 1) {
            // In this case, it's _USDC
            _UNI.createAndInitializePoolIfNecessary(_AGEUR, _USDC, 100, sqrtPriceX96Existing);
            poolCreated = _GUNIFACTORY.createManagedPool(_AGEUR, _USDC, 100, 0, -276320, -273470);
        } else {
            // In this other case it's wETH
            _UNI.createAndInitializePoolIfNecessary(_AGEUR, _WETH, 500, sqrtPriceX96Existing);
            poolCreated = _GUNIFACTORY.createManagedPool(_AGEUR, _WETH, 500, 0, -96120, -69000);
        }
        console.log("poolCreated", poolCreated);
        console.log("agEUR removed", amountAgEUR);
        console.log("Token removed", amountToken);
        IGUniPool(poolCreated).transferOwnership(0xe02F8E39b8cFA7d3b62307E46077669010883459);
        uint256 newGUNIBalance;
        (amountAgEUR, amountToken, newGUNIBalance) = _GUNIROUTER.addLiquidity(
            poolCreated,
            amountAgEUR,
            amountToken,
            amountAgEURMin,
            amountTokenMin,
            liquidityGauge
        );
        console.log("agEUR added", amountAgEUR);
        console.log("Token added", amountToken);
        console.log("Variation in GUNI positions");
        console.log(amountSwapped, newGUNIBalance);
        console.log("Scaling factor");
        console.log((amountSwapped * 10**18) / newGUNIBalance);
        ILiquidityGauge(liquidityGauge).set_staking_token_and_scaling(
            poolCreated,
            (amountSwapped * 10**18) / newGUNIBalance
        );
        if (gaugeType == 1) {
            ILiquidityGauge(liquidityGauge).commit_transfer_ownership(_GOVERNOR);
            IERC20(_USDC).safeTransfer(_GOVERNOR, IERC20(_USDC).balanceOf(address(this)));
        } else {
            ethGUNIPool = poolCreated;
            IERC20(_WETH).safeTransfer(_GOVERNOR, IERC20(_WETH).balanceOf(address(this)));
        }
        IERC20(_AGEUR).safeTransfer(_GOVERNOR, IERC20(_AGEUR).balanceOf(address(this)));
    }

    function finishPoolMigration(uint256 amountAgEURMin, uint256 amountETHMin) external onlyOwner {
        address stakingToken = ILiquidityGauge(_ETHGAUGE).staking_token();
        uint256 amountRecoverable = IERC20(stakingToken).balanceOf(_ETHGAUGE);
        ILiquidityGauge(_ETHGAUGE).recover_erc20(stakingToken, address(this), amountRecoverable);
        uint256 amountAgEUR;
        uint256 amountToken;
        (amountAgEUR, amountToken, ) = _GUNIROUTER.removeLiquidity(
            stakingToken,
            amountRecoverable,
            amountAgEURMin,
            amountETHMin,
            address(this)
        );
        _GUNIROUTER.addLiquidity(ethGUNIPool, amountAgEUR, amountToken, amountAgEURMin, amountETHMin, _ETHGAUGE);
        ILiquidityGauge(_ETHGAUGE).commit_transfer_ownership(_GOVERNOR);
        IERC20(_AGEUR).safeTransfer(_GOVERNOR, IERC20(_AGEUR).balanceOf(address(this)));
        IERC20(_WETH).safeTransfer(_GOVERNOR, IERC20(_WETH).balanceOf(address(this)));
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
