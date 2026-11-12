# Oracle: instance-eni

**Status:** written proof. Not yet verified by AWS Reachability Analyzer.

## Question

Can the internet open a TCP connection to port 443 on `aws_instance.web` and on
`aws_instance.quiet`? Both instances are launched with an existing network interface
(a `network_interface` block, device index 0).

## Setup (the plan creates everything)

- `aws_vpc.main` (`10.22.0.0/16`) with `aws_internet_gateway.main` attached.
- `aws_subnet.public` (`10.22.1.0/24`, `map_public_ip_on_launch = true`), associated with
  `aws_route_table.public` (`0.0.0.0/0` to `aws_internet_gateway.main`). The default NACL is
  not managed (allows all).
- `aws_security_group.web`: in tcp/443 from `0.0.0.0/0`.
- `aws_network_interface.web` and `aws_network_interface.quiet`: both in
  `aws_subnet.public` with `aws_security_group.web`.
- `aws_eip.web` is associated with `aws_network_interface.web`. No Elastic IP is on
  `aws_network_interface.quiet`.

## Proof

An instance launched with an existing interface takes its subnet and security groups
from the interface. AWS assigns an automatic public IPv4 address only to a new interface
for eth0, "not an existing one"
([InstanceNetworkInterfaceSpecification](https://docs.aws.amazon.com/AWSEC2/latest/APIReference/API_InstanceNetworkInterfaceSpecification.html)).
So `map_public_ip_on_launch` does not apply to these instances. A public address can come
only from an Elastic IP on the interface
([Elastic IP addresses](https://docs.aws.amazon.com/AWSEC2/latest/UserGuide/elastic-ip-addresses-eip.html)).

`aws_instance.web`:

1. **Public address.** `aws_eip.web` is on `aws_network_interface.web`. Passes.
2. **Internet gateway.** `aws_internet_gateway.main` is attached to `aws_vpc.main`. Passes.
3. **NACL inbound.** The default NACL allows all. Passes.
4. **Security group.** `aws_security_group.web` (from the interface) allows tcp/443 from
   `0.0.0.0/0`. Passes.
5. **NACL outbound (response).** The default NACL allows all. Passes.
6. **Route (response).** `aws_route_table.public` sends `0.0.0.0/0` to
   `aws_internet_gateway.main`. Passes.

`aws_instance.quiet`:

1. **Public address.** No Elastic IP is on `aws_network_interface.quiet`, and no automatic
   public address is assigned to an existing interface. Fails: blocked.

## Expected result

| | internet to `aws_instance.web` tcp/443 | internet to `aws_instance.quiet` tcp/443 |
|---|---|---|
| Before | `absent` | `absent` |
| After | `allowed` | `blocked` at `public-ip` |
| Diff | path **added** | `unchanged` (not reachable on either side) |

## How to verify with Reachability Analyzer

Use a throwaway account that the maintainer names for the run. Apply `after/` with a real
AMI. Analyze a path from the internet gateway to `aws_instance.web` on TCP 443: reachable.
The same path to `aws_instance.quiet`: not reachable (no public address).
