# LTE IP Address Schema

Status: Draft for review. No network changes have been made.

## Addressing standard

Use `10.20.<VLAN>.<host>` throughout the LTE site. Each VLAN is a `/24` with the gateway at `.1`.

| VLAN | Name | Subnet | DHCP range | Purpose |
|---:|---|---|---|---|
| 10 | NET-MGMT | `10.20.10.0/24` | None | Gateway, switches, access points, controllers |
| 20 | SERVERS | `10.20.20.0/24` | `.100-.199` | Servers, storage, controllers, admin workstations |
| 30 | SECURITY | `10.20.30.0/24` | `.100-.199` | NVRs, Reolink cameras, Ring cameras, access control |
| 40 | POS | `10.20.40.0/24` | `.100-.199` | POS terminals and payment-related systems |
| 45 | SEMNOX | `10.20.45.0/24` | `.100-.199` | Semnox card readers and reader controllers |
| 50 | VOICE | `10.20.50.0/24` | `.100-.199` | VoIP phones |
| 60 | IOT | `10.20.60.0/24` | `.100-.239` | Smart plugs, TVs, audio, SwitchBot and similar devices |
| 70 | STAFF | `10.20.70.0/24` | `.100-.239` | Staff computers, phones and tablets |

Guest Wi-Fi is intentionally excluded from the LTE schema because it will operate on its own network.

Reserve `.2-.99` in each operational VLAN for fixed-IP reservations. Keep `.240-.254` unused for future infrastructure or diagnostics.

## Proposed fixed assignments

### VLAN 10 — Network management

| Proposed IP | Device |
|---|---|
| `10.20.10.1` | LTE Cloud Gateway Ultra |
| `10.20.10.10` | USW Pro Max 24 PoE |
| `10.20.10.30` | AP-TECHROOM-U7 Pro |
| `10.20.10.31` | AP-UPSTAIRS-U7 Pro |
| `10.20.10.32` | AP-Above Partyrooms-U7 Pro |
| `10.20.10.40` | TL-SG105E, currently `192.168.1.141` |
| `10.20.10.41` | TL-SG105E, currently `192.168.1.157` |

### VLAN 20 — Servers and administration

| Proposed IP | Device | Current IP |
|---|---|---|
| `10.20.20.10` | LTEBackupCloud (Western Digital) | `192.168.1.97` |
| `10.20.20.20` | pxl-main (Fedora) | `192.168.1.209` |
| `10.20.20.30` | Manager2-PC | `192.168.1.132` |

### VLAN 30 — Security and access control

| Proposed IP | Device | Current IP / identifier |
|---|---|---|
| `10.20.30.10` | Reolink NVR — LTE | `192.168.1.140` |
| `10.20.30.11` | Reolink NVR | `192.168.1.212` |
| `10.20.30.12` | Reolink NVR2 | `192.168.1.199` |
| `10.20.30.20` | LTE-OFFICE-MAIN (2N access/intercom) | `192.168.1.152` |
| `10.20.30.30` | Reolink RLC-811A | S/N `PWP01NDL21LJNN` |
| `10.20.30.31` | Reolink RLC-811A | S/N `PWP00U1HXVFZCP` |
| `10.20.30.32` | Reolink RLC-811A | S/N `PWP00U1MRR6EDS` |
| `10.20.30.33` | Reolink RLC-843A | S/N `PWP00W1Q8ADN2` |
| `10.20.30.50` | Ring Indoor Security Camera | `192.168.1.155` |
| `10.20.30.51` | Ring-187f88953409 | `192.168.1.207` |
| `10.20.30.52` | Ring-649a633C6F65 | `192.168.1.222` |
| `10.20.30.53` | Ring-649a63426977 | `192.168.1.253` |

### VLAN 40 — POS

| Proposed IP | Device | Current IP |
|---|---|---|
| `10.20.40.10` | POS2-MAIN | `192.168.1.194` |

### VLAN 45 — Semnox card readers

Reserve a contiguous fixed-address block for 50 planned readers. Assign addresses by physical location rather than installation order so technicians can identify a reader from its IP.

| Range | Use |
|---|---|
| `10.20.45.1` | VLAN gateway |
| `10.20.45.2-.9` | Semnox servers, controllers or gateways |
| `10.20.45.10-.19` | Reserved for infrastructure expansion |
| `10.20.45.20-.69` | Card readers 01-50 |
| `10.20.45.70-.99` | Future fixed card readers |
| `10.20.45.100-.199` | DHCP staging and service devices |
| `10.20.45.200-.254` | Reserved for future growth |

Suggested naming pattern: `LTE-SMX-<AREA>-<NUMBER>`, for example `LTE-SMX-LAZER-01`. Record the full MAC address, physical location, attraction/device served, switch and port for every reader.

### VLAN 50 — Voice

| Proposed IP | Device | Current IP |
|---|---|---|
| `10.20.50.10` | SIP-T34W `4e:93` | `192.168.1.149` |
| `10.20.50.11` | SIP-T34W `56:c1` | `192.168.1.206` |
| `10.20.50.12` | SIP-T34W `57:f3` | `192.168.1.122` |
| `10.20.50.13` | SIP-T34W `5a:e0` | `192.168.1.243` |
| `10.20.50.14` | SIP-T34W `5c:59` | `192.168.1.236` |

### VLAN 60 — IoT and entertainment

| Proposed IP | Device | Current IP |
|---|---|---|
| `10.20.60.10` | LGwebOSTV | `192.168.1.64` |
| `10.20.60.11` | LG SL8YG Soundbar | `192.168.1.223` |
| `10.20.60.12` | Pixelgames (TCL) | `192.168.1.245` |
| `10.20.60.13` | Xumo | `192.168.1.101` |
| `10.20.60.20` | SwitchBot-HubMini-51F6B1 | `192.168.1.173` |
| `10.20.60.21` | SwitchBot-HubMiniMatter-54CE5C | `192.168.1.153` |
| `10.20.60.30` | KP115 `c0:56` | `192.168.1.139` |
| `10.20.60.31` | KS200M `44:3d` | `192.168.1.211` |
| `10.20.60.32` | P105 `53:97` | `192.168.1.151` |
| `10.20.60.33` | P105 `53:dd` | `192.168.1.220` |
| `10.20.60.34` | P110M `d4:65` | `192.168.1.116` |
| `10.20.60.35` | P110M `d5:f4` | `192.168.1.119` |
| `10.20.60.36` | P110M `de:93` | `192.168.1.79` |
| `10.20.60.37` | P110M `ec:95` | `192.168.1.198` |
| `10.20.60.38` | P110M `ec:bd` | `192.168.1.237` |

### VLAN 70 — Staff clients

Use DHCP reservations only where a stable address is operationally useful.

| Device | Current IP |
|---|---|
| Pixel-9-Pro-XL | `192.168.1.126` |
| SydneysiPhone2 | `192.168.1.214` |
| Main (TP-Link) | `192.168.1.232` |

## Initial firewall policy

- NET-MGMT: allow only trusted administrator devices to initiate connections; block client VLAN access by default.
- SERVERS: allow only required ports from trusted VLANs; allow administration from approved staff devices.
- SECURITY: allow cameras to reach their NVRs, DNS and NTP; block camera-initiated access to other internal VLANs. Permit viewing from approved staff devices.
- POS: isolate from all other client VLANs; allow only required payment, DNS, NTP and management destinations.
- SEMNOX: allow only the Semnox application/database services, DNS, NTP and approved management sources. Block direct access to POS, network management, IoT and staff clients unless a documented Semnox dependency requires it.
- VOICE: allow required PBX/SIP provider, DNS and NTP traffic; block access to POS and network management.
- IOT: block access to NET-MGMT, SERVERS and POS; allow internet access and narrowly scoped controller traffic.
- STAFF: allow internet and specifically approved internal services.
- Guest network: maintain separately from LTE, with internet-only access and client isolation.

## Migration order

1. Create VLANs, DHCP scopes and firewall rules without changing current clients.
2. Move network-management interfaces and verify administrative access.
3. Move one low-risk IoT device and validate DNS, internet access and isolation.
4. Move security equipment, beginning with one camera, and verify recording/viewing before continuing.
5. Pilot one Semnox reader, verify all application and database communication, and then migrate readers in location-based groups.
6. Move phones and confirm calling.
7. Move staff clients.
8. Move POS last, during a maintenance window, with a rollback plan.
9. Retire the old `192.168.1.0/24` LAN only after all devices are accounted for.

## Information still needed

- Full MAC addresses for reliable DHCP reservations; the pasted inventory contains only the last two octets.
- Names/locations for each smart plug, phone, Ring camera and Reolink camera.
- Current IP addresses or NVR PoE-channel topology for the four Reolink cameras.
- Confirmation of which Reolink unit is `NVR`, `NVR2`, and the previously identified third NVR.
- Required POS vendor destinations and ports before enforcing restrictive firewall rules.
- Semnox server/controller addresses, required ports, reader MAC addresses and physical locations.
