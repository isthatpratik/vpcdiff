# Azure: internet to virtual machines (#96)

The first Azure scope ([ADR 0011](../adr/0011-multi-cloud.md)): IPv4 paths from the internet
to a virtual machine (`azurerm_linux_virtual_machine`, `azurerm_windows_virtual_machine`).
Each path has `provider: "azure"`. Its hops are `public-ip`, `nsg`, and `route`.

## AWS terms and Azure terms

| AWS | Azure |
|---|---|
| VPC | Virtual network (`azurerm_virtual_network`) |
| Subnet | Subnet (`azurerm_subnet`) |
| Security group and NACL | Network security group (NSG) on the subnet and on the network interface |
| Elastic IP | Public IP address (`azurerm_public_ip`) on the interface's IP configuration |
| Route table | Route table (`azurerm_route_table`) with user-defined routes (UDRs) |

## Rules

1. **Public IP address.** A VM is reachable from the internet through a public IP address
   on its network interface's IP configuration (`public_ip_address_id`).
   Source: <https://learn.microsoft.com/en-us/azure/virtual-network/ip-services/public-ip-addresses>
2. **Standard SKU is closed by default.** A Standard public IP is "closed to inbound
   traffic" unless a network security group allows it: "All network traffic is blocked
   through a subnet and network interface if they don't have a network security group
   associated to them. The virtual machine with a standard public IP address is secure by
   default." Basic SKU public IPs "were retired" on September 30, 2025.
   Source: <https://learn.microsoft.com/en-us/azure/virtual-network/network-security-group-how-it-works>
   Source: <https://learn.microsoft.com/en-us/azure/virtual-network/ip-services/public-ip-addresses>
3. **Two NSGs in order.** "For inbound traffic, Azure first processes the rules in a
   network security group associated with a subnet if one exists. Azure then processes
   the rules in a network security group associated with the network interface if one
   exists." Both must allow. A level without an NSG passes the traffic on.
   Source: <https://learn.microsoft.com/en-us/azure/virtual-network/network-security-group-how-it-works>
4. **Priority.** "Rules are processed in priority order, with lower numbers processed
   before higher numbers ... Once traffic matches a rule, processing stops." Every NSG has
   the default inbound rules `AllowVNetInBound` (65000, VirtualNetwork),
   `AllowAzureLoadBalancerInBound` (65001, AzureLoadBalancer), and `DenyAllInbound`
   (65500).
   Source: <https://learn.microsoft.com/en-us/azure/virtual-network/network-security-groups-overview>
5. **Addresses after translation.** "For inbound traffic, network security groups process
   traffic after Azure translates public IP addresses to private IP addresses." So the
   destination of a rule must cover the VM's private address, which is somewhere in its
   subnet.
   Source: <https://learn.microsoft.com/en-us/azure/virtual-network/network-security-groups-overview>
6. **Service tags.** `Internet` is "The IP address space that's outside the virtual
   network and reachable by the public internet." `AzureLoadBalancer` "translates to the
   virtual IP address of the host (168.63.129.16)", only health probes. `VirtualNetwork`
   is the virtual network address space and connected spaces.
   Source: <https://learn.microsoft.com/en-us/azure/virtual-network/service-tags-overview>
7. **Stateful.** "If inbound traffic is allowed over a port, it's not necessary to specify
   an outbound security rule to respond to traffic over the port."
   Source: <https://learn.microsoft.com/en-us/azure/virtual-network/network-security-groups-overview>
8. **Routes.** Every subnet has the system routes `0.0.0.0/0` to `Internet` and `None`
   (drop) for `157.59.0.0/16`, `104.147.0.0/16`, and `104.146.0.0/17`, among private
   ranges. Longest prefix wins; a user-defined route overrides a system route with the
   same prefix. When `0.0.0.0/0` is overridden to a virtual appliance or a virtual network
   gateway, "You can no longer directly access resources in the subnet from the
   internet."
   Source: <https://learn.microsoft.com/en-us/azure/virtual-network/virtual-networks-udr-overview>

## Hops

1. **`public-ip`**: the primary IP configuration of the VM's network interface has a
   Standard public IP address in the plan. No public IP gives `blocked`.
2. **`nsg`**: the subnet's NSG, then the interface's NSG (rule 3), each from the lowest
   priority with its default rules at the end (rule 4). Allowed sources are those both
   allow. When neither level has an NSG, `blocked` (rule 2).
3. **`route`**: the subnet's routes for the response to each allowed source (rule 8):
   `Internet` keeps the source, `None` drops it, and `0.0.0.0/0` to an appliance or a
   gateway blocks direct access. A more specific route to an appliance or a gateway makes
   those sources undecided.

The internet is the public IPv4 space without `168.63.129.16` (the platform address),
without every virtual network's address space, and without the three public ranges that
the system routes drop (a client there never gets a response).

## Returns `unknown` with a reason

- A Basic SKU public IP (retired, and open by default).
- More than one network interface, or more than one IP configuration on it.
- A rule source that is a service tag other than `Internet`, `VirtualNetwork`, and
  `AzureLoadBalancer`; a `VirtualNetwork` source where an address space is public; a
  destination application security group; a destination that covers only part of the
  subnet; a source port range other than `*`.
- A value that matters is unknown until apply, or a referenced resource is not in the
  plan.

## Scope

- Load balancers, NAT gateways, Azure Firewall, Bastion, virtual network peering, and
  Azure Virtual Network Manager security admin rules are not modeled. Admin rules "always
  have a higher priority than network security group rules", and they are not in a
  project's plan.
- IPv6 and paths between VMs are not modeled yet.
