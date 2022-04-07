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
import "../interfaces/IUniswapV3Router.sol";

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
    address private constant _GUNIUSDC = 0x2bD9F7974Bc0E4Cb19B8813F8Be6034F3E772add;
    address private constant _GUNIETH = 0x26C2251801D2cfb5461751c984Dc3eAA358bdf0f;
    address private constant _ETHNEWPOOL = 0x8dB1b906d47dFc1D84A87fc49bd0522e285b98b9;
    IUniswapPositionManager private constant _UNI = IUniswapPositionManager(0xC36442b4a4522E871399CD717aBDD847Ab11FE88);
    address private constant _UNIROUTER = 0xE592427A0AEce92De3Edee1F18E0157C05861564;

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
        address stakingToken;
        uint160 sqrtPriceX96Existing;
        address token;
        if (gaugeType == 1) {
            liquidityGauge = _USDCGAUGE;
            stakingToken = _GUNIUSDC;
            token = _USDC;
            (sqrtPriceX96Existing, , , , , , ) = IUniswapV3Pool(_UNIUSDCPOOL).slot0();
        } else {
            liquidityGauge = _ETHGAUGE;
            stakingToken = _GUNIETH;
            token = _WETH;
        }
        // Giving allowances: we need it to add and remove liquidity
        IERC20(token).safeApprove(address(_GUNIROUTER), type(uint256).max);
        IERC20(stakingToken).safeApprove(address(_GUNIROUTER), type(uint256).max);
        IERC20(_AGEUR).safeIncreaseAllowance(
            address(_GUNIROUTER),
            type(uint256).max - IERC20(_AGEUR).allowance(address(this), address(_GUNIROUTER))
        );
        // Computing amount to recover
        uint256 amountRecovered = IERC20(stakingToken).balanceOf(liquidityGauge);
        ILiquidityGauge(liquidityGauge).accept_transfer_ownership();
        ILiquidityGauge(liquidityGauge).recover_erc20(stakingToken, address(this), amountRecovered);

        uint256 amountAgEUR;
        uint256 amountToken;
        // Removing all liquidity
        (amountAgEUR, amountToken, ) = _GUNIROUTER.removeLiquidity(
            stakingToken,
            amountRecovered,
            amountAgEURMin,
            amountTokenMin,
            address(this)
        );
        if (gaugeType == 1) {
            // In this case, it's _USDC: we need to create the pool
            _UNI.createAndInitializePoolIfNecessary(_AGEUR, _USDC, 100, sqrtPriceX96Existing);
            poolCreated = _GUNIFACTORY.createManagedPool(_AGEUR, _USDC, 100, 0, -276320, -273470);
        } else {
            // In this other case it's wETH
            // Increasing observation cardinality on the new pool (it already exists)
            IUniswapV3Pool(_ETHNEWPOOL).increaseObservationCardinalityNext(144);
            // poolCreated = _GUNIFACTORY.createManagedPool(_AGEUR, _WETH, 500, 0, -96120, -70180);

            // compute the lower tick to not have nearly al liquidity invested
            int256 ratioAmounts = (int256(amountToken) * 10**18) / int256(amountAgEUR);
            // sqrt price upper bound np.sqrt(0.000311878658174707), where 0.000311878658174707 is the current price on the pool
            int256 sqrtPrice = 17660086584575598;
            // sqrt price upper bound np.sqrt(1/991), where 991 is just the price derived from the tick -69000
            int256 sqrtUpperPrice = 31766046899489794;
            int128 sqrtPriceLower = int128(
                sqrtPrice +
                    ((ratioAmounts * ((10**18 * 10**18) / sqrtUpperPrice - (10**18 * 10**18) / sqrtPrice)) / 10**18)
            );
            int128 priceLower = (sqrtPriceLower * sqrtPriceLower) / 10**18;
            int128 lowerTick = ((ln(priceLower) - ln(10**18)) / (ln(1000100000000000000) - ln(10**18)));
            lowerTick = (lowerTick / 10) * 10;

            // change the ticks of the position
            poolCreated = _GUNIFACTORY.createManagedPool(_AGEUR, _WETH, 500, 0, int24(lowerTick), -69000);
        }

        // Adding liquidity
        _GUNIROUTER.addLiquidity(poolCreated, amountAgEUR, amountToken, amountAgEURMin, amountTokenMin, liquidityGauge);

        IGUniPool(poolCreated).executiveRebalance(-96120, -69000, 0, 0, false);
        // Transfering ownership of the new pool ot AngleMaster
        IGUniPool(poolCreated).transferOwnership(0xe02F8E39b8cFA7d3b62307E46077669010883459);

        uint256 newGUNIBalance = IERC20(poolCreated).balanceOf(liquidityGauge);
        console.log("agEUR leftover finally", IERC20(_AGEUR).balanceOf(address(this)));
        console.log("Token leftover finally", IERC20(token).balanceOf(address(this)));
        console.log("Variation in GUNI positions");
        console.log(amountRecovered, newGUNIBalance);
        console.log("Scaling factor");
        console.log((amountRecovered * 10**18) / newGUNIBalance);
        ILiquidityGauge(liquidityGauge).set_staking_token_and_scaling_factor(
            poolCreated,
            (amountRecovered * 10**18) / newGUNIBalance
        );
        ILiquidityGauge(liquidityGauge).commit_transfer_ownership(_GOVERNOR);
        IERC20(token).safeTransfer(_GOVERNOR, IERC20(token).balanceOf(address(this)));
        IERC20(_AGEUR).safeTransfer(_GOVERNOR, IERC20(_AGEUR).balanceOf(address(this)));
    }

    /**
     * Calculate binary logarithm of x.  Revert if x <= 0.
     *
     * @param x signed 64.64-bit fixed point number
     * @return signed 64.64-bit fixed point number
     */
    function log_2(int128 x) internal pure returns (int128) {
        unchecked {
            require(x > 0);

            int256 msb = 0;
            int256 xc = x;
            if (xc >= 0x10000000000000000) {
                xc >>= 64;
                msb += 64;
            }
            if (xc >= 0x100000000) {
                xc >>= 32;
                msb += 32;
            }
            if (xc >= 0x10000) {
                xc >>= 16;
                msb += 16;
            }
            if (xc >= 0x100) {
                xc >>= 8;
                msb += 8;
            }
            if (xc >= 0x10) {
                xc >>= 4;
                msb += 4;
            }
            if (xc >= 0x4) {
                xc >>= 2;
                msb += 2;
            }
            if (xc >= 0x2) msb += 1; // No need to shift xc anymore

            int256 result = (msb - 64) << 64;
            uint256 ux = uint256(int256(x)) << uint256(127 - msb);
            for (int256 bit = 0x8000000000000000; bit > 0; bit >>= 1) {
                ux *= ux;
                uint256 b = ux >> 255;
                ux >>= 127 + b;
                result += bit * int256(b);
            }

            return int128(result);
        }
    }

    /**
     * Calculate natural logarithm of x.  Revert if x <= 0.
     *
     * @param x signed 64.64-bit fixed point number
     * @return signed 64.64-bit fixed point number
     */
    function ln(int128 x) internal pure returns (int128) {
        unchecked {
            require(x > 0);

            return int128(int256((uint256(int256(log_2(x))) * 0xB17217F7D1CF79ABC9E3B39803F2F6AF) >> 128));
        }
    }

    function _swapLogic(
        uint256 ethBalance,
        uint256 agEURBalance,
        address poolCreated,
        address liquidityGauge
    ) internal {
        if (ethBalance > (10**18) / 2) {
            IERC20(_WETH).safeApprove(_UNIROUTER, ethBalance / 2);
            uint256 amountOut = IUniswapV3Router(_UNIROUTER).exactInputSingle(
                ExactInputSingleParams(_WETH, _AGEUR, 500, address(this), block.timestamp, ethBalance / 2, 0, 0)
            );
            _GUNIROUTER.addLiquidity(poolCreated, agEURBalance + amountOut, ethBalance / 2, 0, 0, liquidityGauge);
            console.log("Did an ETH swap to reinstore equilibrium");
            console.log("Amount Out", amountOut);
        } else if (agEURBalance > 1000 * 10**18) {
            IERC20(_AGEUR).safeApprove(_UNIROUTER, agEURBalance / 2);
            uint256 amountOut = IUniswapV3Router(_UNIROUTER).exactInputSingle(
                ExactInputSingleParams(_AGEUR, _WETH, 500, address(this), block.timestamp, agEURBalance / 2, 0, 0)
            );
            _GUNIROUTER.addLiquidity(poolCreated, agEURBalance / 2, ethBalance + amountOut, 0, 0, liquidityGauge);
            console.log("Did an agEUR swap to reinstore equilibrium");
            console.log("Amount Out", amountOut);
        }
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
