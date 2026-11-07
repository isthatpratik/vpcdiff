# IPv6 paths from the internet

The engine checks IPv6 paths from the internet in the same six hops as IPv4, on IPv6
address sets. Paths inside the VPC are IPv4 only.

## AWS rules

1. **Addresses.** IPv6 addresses in AWS are globally unique, so an interface with one
   can be addressed from the internet when the other hops allow it. An instance gets
   them with `ipv6_address_count`, `ipv6_addresses`, or the subnet's
   `assign_ipv6_address_on_creation`. A dual-stack internet-facing load balancer
   (`ip_address_type = "dualstack"` or `"dualstack-without-public-ipv4"`) has them too.
   Source: <https://docs.aws.amazon.com/vpc/latest/userguide/vpc-ip-addressing.html>
2. **Internet gateway.** "add a route with a destination of `0.0.0.0/0` for IPv4 traffic
   or `::/0` for IPv6 traffic, and a target of the internet gateway ID."
   Source: <https://docs.aws.amazon.com/vpc/latest/userguide/route-table-options.html>
3. **Egress-only internet gateway.** It lets instances "initiate outbound communication
   to the internet, but prevent the internet from initiating connections with the
   instances." A response routed to one does not return: **blocked**.
   Source: <https://docs.aws.amazon.com/vpc/latest/userguide/egress-only-internet-gateway.html>
4. **Security groups and NACLs** have separate IPv6 entries (`ipv6_cidr_blocks`,
   `cidr_ipv6`, `ipv6_cidr_block`). IPv4 entries never match IPv6 traffic. The default
   NACL of a VPC with an IPv6 block also allows all IPv6 traffic (rule 101).
   Source: <https://docs.aws.amazon.com/vpc/latest/userguide/default-network-acl.html>

## Engine behavior

- Internet sources: global unicast `2000::/3`, minus the VPC's IPv6 block when it is
  known before apply. Unique local, link-local, and multicast addresses are not sources.
- Paths have `family: "ipv6"` and IDs that start with `internet6->`. `sources` is
  `["internet"]` for every global address, else IPv6 CIDRs.
- Returns `unknown`: an IPv6 setting that is unknown until apply, a response route to a
  target other than the internet gateway (transit gateway, network interface, ...), and
  `aws_vpc_ipv6_cidr_block_association`.
- Not modeled yet for IPv6: RDS, Aurora, ECS, Classic Load Balancers, VPC endpoints
  (they get no IPv6 path), IPv6 prefix lists, and paths inside the VPC.
