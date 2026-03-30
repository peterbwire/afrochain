// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

contract AfroCoin {
    string public constant name = "AfroCoin";
    string public constant symbol = "AFC";
    uint8 public constant decimals = 6;

    uint256 public totalSupply;
    address public owner;
    address public governanceDAO;
    address public stakingModule;

    mapping(address => uint256) public balanceOf;
    mapping(address => mapping(address => uint256)) public allowance;
    mapping(address => bool) public minters;

    event Approval(address indexed owner, address indexed spender, uint256 value);
    event GovernanceDAOUpdated(address indexed dao);
    event MinterUpdated(address indexed account, bool enabled);
    event StakingModuleUpdated(address indexed module);
    event Transfer(address indexed from, address indexed to, uint256 value);
    event CorridorPayment(
        address indexed from,
        address indexed to,
        uint256 amount,
        string originCountry,
        string destinationCountry,
        string rail
    );

    modifier onlyOwner() {
        require(msg.sender == owner, "AfroCoin: owner only");
        _;
    }

    modifier onlyMinter() {
        require(minters[msg.sender], "AfroCoin: minter only");
        _;
    }

    constructor(address treasury, uint256 initialSupply) {
        owner = msg.sender;
        governanceDAO = msg.sender;
        minters[msg.sender] = true;
        _mint(treasury, initialSupply);
    }

    function transfer(address to, uint256 value) external returns (bool) {
        _transfer(msg.sender, to, value);
        return true;
    }

    function approve(address spender, uint256 value) external returns (bool) {
        allowance[msg.sender][spender] = value;
        emit Approval(msg.sender, spender, value);
        return true;
    }

    function transferFrom(address from, address to, uint256 value) external returns (bool) {
        uint256 currentAllowance = allowance[from][msg.sender];
        require(currentAllowance >= value, "AfroCoin: allowance too low");

        allowance[from][msg.sender] = currentAllowance - value;
        _transfer(from, to, value);
        emit Approval(from, msg.sender, allowance[from][msg.sender]);
        return true;
    }

    function transferAcrossCorridor(
        address to,
        uint256 value,
        string calldata originCountry,
        string calldata destinationCountry,
        string calldata rail
    ) external returns (bool) {
        _transfer(msg.sender, to, value);
        emit CorridorPayment(msg.sender, to, value, originCountry, destinationCountry, rail);
        return true;
    }

    function mint(address to, uint256 value) external onlyMinter returns (bool) {
        _mint(to, value);
        return true;
    }

    function setMinter(address account, bool enabled) external onlyOwner {
        minters[account] = enabled;
        emit MinterUpdated(account, enabled);
    }

    function setGovernanceDAO(address dao) external onlyOwner {
        governanceDAO = dao;
        emit GovernanceDAOUpdated(dao);
    }

    function setStakingModule(address module) external onlyOwner {
        stakingModule = module;
        emit StakingModuleUpdated(module);
    }

    function transferOwnership(address nextOwner) external onlyOwner {
        require(nextOwner != address(0), "AfroCoin: zero owner");
        owner = nextOwner;
    }

    function _mint(address to, uint256 value) internal {
        require(to != address(0), "AfroCoin: zero mint");
        totalSupply += value;
        balanceOf[to] += value;
        emit Transfer(address(0), to, value);
    }

    function _transfer(address from, address to, uint256 value) internal {
        require(to != address(0), "AfroCoin: zero recipient");
        require(balanceOf[from] >= value, "AfroCoin: balance too low");

        balanceOf[from] -= value;
        balanceOf[to] += value;
        emit Transfer(from, to, value);
    }
}
