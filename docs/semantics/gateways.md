# Gateways

## Internet gateway: AWS rules

1. **Needs a public address.** "An internet gateway enables resources in your public
   subnets (such as EC2 instances) to connect to the internet if the resource has a
   public IPv4 address or an IPv6 address. Similarly, resources on the internet can
   initiate a connection to resources in your subnet using the public IPv4 address or
   IPv6 address."
   Source: <https://docs.aws.amazon.com/vpc/latest/userguide/VPC_Internet_Gateway.html>
2. **Must be attached and routed.** The gateway must be attached to the VPC, and the
   subnet's route table must have a route to it.
   Source: <https://docs.aws.amazon.com/vpc/latest/userguide/VPC_Internet_Gateway.html>

## Terraform differences

- `aws_internet_gateway` with `vpc_id` creates and attaches the gateway.
  `aws_internet_gateway_attachment` is a separate way to attach it.
- An instance gets a public IPv4 address from `associate_public_ip_address`. When that
  argument is not set, the subnet's `map_public_ip_on_launch` decides.

## Engine behavior

The internet-to-instance path needs all of these:

1. The instance has a public IPv4 address.
2. An internet gateway is attached to the instance's VPC.
3. The subnet's route for the client address targets that gateway
   (see [route-tables.md](route-tables.md)).

If item 1 or 2 is missing, the result is `blocked` at the gateway hop.

## Internet sources

The engine treats "the internet" as every public IPv4 address outside the VPC. It
removes these ranges, which never arrive from the internet through an internet
gateway: `0.0.0.0/8`, `10.0.0.0/8`, `100.64.0.0/10`, `127.0.0.0/8`, `169.254.0.0/16`,
`172.16.0.0/12`, `192.168.0.0/16`, `224.0.0.0/4`, and `240.0.0.0/4`.
Source: <https://www.iana.org/assignments/iana-ipv4-special-registry/>

The documentation ranges (`192.0.2.0/24`, `198.51.100.0/24`, `203.0.113.0/24`) stay
in, so examples that use them behave like public addresses.

A result with `sources: ["internet"]` means every address in this set can reach the
target. Otherwise `sources` lists the CIDRs that can.

## Slice 1 scope

Handled:

- `aws_internet_gateway` with `vpc_id`, and `aws_internet_gateway_attachment`.
- `aws_eip` with `instance`, and `aws_eip_association` with `instance_id`: the instance
  has a public IPv4 address.
  Source: <https://docs.aws.amazon.com/AWSEC2/latest/UserGuide/elastic-ip-addresses-eip.html>
- `associate_public_ip_address` set to `true` or `false` on `aws_instance`.
- `map_public_ip_on_launch` on `aws_subnet`, when the instance does not set
  `associate_public_ip_address`.

Returns `unknown` with a reason:

- An Elastic IP associated with a network interface.
- An internet gateway outside the plan that a route points at.
- A public IP setting that is unknown in the plan.

Not modeled yet: NAT gateways and egress-only internet gateways. They carry traffic
that starts inside the VPC, which slice 1 does not evaluate.
