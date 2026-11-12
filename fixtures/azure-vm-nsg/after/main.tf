# Fixture azure-vm-nsg: two Azure VMs with Standard public IPs.
# - web: the subnet's NSG allows SSH from the internet; the NIC's NSG denies one range
#   first (priority 100), then allows SSH (110).
# - behind: its subnet sends 0.0.0.0/0 to a virtual appliance, so it cannot be reached
#   directly from the internet, although its NSG allows HTTPS.
# Synthetic values only. Everything is created by this plan. Planned against a local
# stand-in for the Azure endpoints (scripts/azure-standin.ts); no Azure account is used.

terraform {
  required_providers {
    azurerm = { source = "hashicorp/azurerm", version = "= 5.13.0" }
  }
}

provider "azurerm" {
  features {}
}

variable "admin_password" {
  type      = string
  sensitive = true
  default   = "Placeholder-Not-A-Secret-1"
}

resource "azurerm_resource_group" "main" {
  name     = "vpcdiff-demo"
  location = "eastus"
}

resource "azurerm_virtual_network" "main" {
  name                = "main"
  location            = azurerm_resource_group.main.location
  resource_group_name = azurerm_resource_group.main.name
  address_space       = ["10.60.0.0/16"]
}

resource "azurerm_subnet" "web" {
  name                 = "web"
  resource_group_name  = azurerm_resource_group.main.name
  virtual_network_name = azurerm_virtual_network.main.name
  address_prefixes     = ["10.60.1.0/24"]
}

resource "azurerm_subnet" "behind" {
  name                 = "behind"
  resource_group_name  = azurerm_resource_group.main.name
  virtual_network_name = azurerm_virtual_network.main.name
  address_prefixes     = ["10.60.2.0/24"]
}

resource "azurerm_network_security_group" "web_subnet" {
  name                = "web-subnet"
  location            = azurerm_resource_group.main.location
  resource_group_name = azurerm_resource_group.main.name

  security_rule {
    name                       = "ssh"
    priority                   = 100
    direction                  = "Inbound"
    access                     = "Allow"
    protocol                   = "Tcp"
    source_port_range          = "*"
    destination_port_range     = "22"
    source_address_prefix      = "Internet"
    destination_address_prefix = "*"
  }
}

resource "azurerm_subnet_network_security_group_association" "web" {
  subnet_id                 = azurerm_subnet.web.id
  network_security_group_id = azurerm_network_security_group.web_subnet.id
}

resource "azurerm_network_security_group" "web_nic" {
  name                = "web-nic"
  location            = azurerm_resource_group.main.location
  resource_group_name = azurerm_resource_group.main.name
}

# A lower number is processed first: this range never reaches SSH.
resource "azurerm_network_security_rule" "deny_range" {
  name                        = "deny-range"
  priority                    = 100
  direction                   = "Inbound"
  access                      = "Deny"
  protocol                    = "Tcp"
  source_port_range           = "*"
  destination_port_range      = "22"
  source_address_prefix       = "198.51.100.0/24"
  destination_address_prefix  = "*"
  resource_group_name         = azurerm_resource_group.main.name
  network_security_group_name = azurerm_network_security_group.web_nic.name
}

resource "azurerm_network_security_rule" "ssh_nic" {
  name                        = "ssh"
  priority                    = 110
  direction                   = "Inbound"
  access                      = "Allow"
  protocol                    = "Tcp"
  source_port_range           = "*"
  destination_port_range      = "22"
  source_address_prefix       = "*"
  destination_address_prefix  = "*"
  resource_group_name         = azurerm_resource_group.main.name
  network_security_group_name = azurerm_network_security_group.web_nic.name
}

resource "azurerm_public_ip" "web" {
  name                = "web"
  location            = azurerm_resource_group.main.location
  resource_group_name = azurerm_resource_group.main.name
  allocation_method   = "Static"
  sku                 = "Standard"
}

resource "azurerm_network_interface" "web" {
  name                = "web"
  location            = azurerm_resource_group.main.location
  resource_group_name = azurerm_resource_group.main.name

  ip_configuration {
    name                          = "primary"
    subnet_id                     = azurerm_subnet.web.id
    private_ip_address_allocation = "Dynamic"
    public_ip_address_id          = azurerm_public_ip.web.id
  }
}

resource "azurerm_network_interface_security_group_association" "web" {
  network_interface_id      = azurerm_network_interface.web.id
  network_security_group_id = azurerm_network_security_group.web_nic.id
}

resource "azurerm_linux_virtual_machine" "web" {
  name                            = "web"
  location                        = azurerm_resource_group.main.location
  resource_group_name             = azurerm_resource_group.main.name
  size                            = "Standard_B1s"
  admin_username                  = "azureuser"
  admin_password                  = var.admin_password
  disable_password_authentication = false
  network_interface_ids           = [azurerm_network_interface.web.id]

  os_disk {
    caching              = "ReadWrite"
    storage_account_type = "Standard_LRS"
  }

  source_image_reference {
    publisher = "Canonical"
    offer     = "ubuntu-24_04-lts"
    sku       = "server"
    version   = "latest"
  }
}

resource "azurerm_network_security_group" "behind" {
  name                = "behind"
  location            = azurerm_resource_group.main.location
  resource_group_name = azurerm_resource_group.main.name

  security_rule {
    name                       = "https"
    priority                   = 100
    direction                  = "Inbound"
    access                     = "Allow"
    protocol                   = "Tcp"
    source_port_range          = "*"
    destination_port_range     = "443"
    source_address_prefix      = "*"
    destination_address_prefix = "*"
  }
}

resource "azurerm_subnet_network_security_group_association" "behind" {
  subnet_id                 = azurerm_subnet.behind.id
  network_security_group_id = azurerm_network_security_group.behind.id
}

resource "azurerm_route_table" "behind" {
  name                = "behind"
  location            = azurerm_resource_group.main.location
  resource_group_name = azurerm_resource_group.main.name

  route {
    name                   = "all-through-appliance"
    address_prefix         = "0.0.0.0/0"
    next_hop_type          = "VirtualAppliance"
    next_hop_in_ip_address = "10.60.9.4"
  }
}

resource "azurerm_subnet_route_table_association" "behind" {
  subnet_id      = azurerm_subnet.behind.id
  route_table_id = azurerm_route_table.behind.id
}

resource "azurerm_public_ip" "behind" {
  name                = "behind"
  location            = azurerm_resource_group.main.location
  resource_group_name = azurerm_resource_group.main.name
  allocation_method   = "Static"
  sku                 = "Standard"
}

resource "azurerm_network_interface" "behind" {
  name                = "behind"
  location            = azurerm_resource_group.main.location
  resource_group_name = azurerm_resource_group.main.name

  ip_configuration {
    name                          = "primary"
    subnet_id                     = azurerm_subnet.behind.id
    private_ip_address_allocation = "Dynamic"
    public_ip_address_id          = azurerm_public_ip.behind.id
  }
}

resource "azurerm_linux_virtual_machine" "behind" {
  name                            = "behind"
  location                        = azurerm_resource_group.main.location
  resource_group_name             = azurerm_resource_group.main.name
  size                            = "Standard_B1s"
  admin_username                  = "azureuser"
  admin_password                  = var.admin_password
  disable_password_authentication = false
  network_interface_ids           = [azurerm_network_interface.behind.id]

  os_disk {
    caching              = "ReadWrite"
    storage_account_type = "Standard_LRS"
  }

  source_image_reference {
    publisher = "Canonical"
    offer     = "ubuntu-24_04-lts"
    sku       = "server"
    version   = "latest"
  }
}
