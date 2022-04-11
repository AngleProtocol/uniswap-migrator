import { network, ethers, deployments, contract } from 'hardhat';
import { utils } from 'ethers';

async function main() {
  const { deploy } = deployments;
  const { deployer } = await ethers.getNamedSigners();

  const ethPoolInterface = new utils.Interface([
    'function increaseObservationCardinalityNext(uint16 observationCardinalityNext) external',
  ]);

  const poolAddress = '0x8dB1b906d47dFc1D84A87fc49bd0522e285b98b9';
  const ethPoolContract = new ethers.Contract(poolAddress, ethPoolInterface, deployer);
  console.log('Increasing observation cardinality for Euler');
  const receipt = await (await ethPoolContract.connect(deployer).increaseObservationCardinalityNext(144)).wait();
  console.log('Success with gas', receipt.gasUsed.toString());
}

main().catch(error => {
  console.error(error);
  process.exit(1);
});
