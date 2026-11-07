from __future__ import annotations
import copy
import json
from pathlib import Path
from jsonschema import Draft202012Validator

ROOT=Path(__file__).resolve().parents[1]
SCHEMAS=[
    "scenario-source.schema.json",
    "scenario-normalized.schema.json",
    "enterprise-baseline.schema.json",
    "enterprise-mapping-profile.schema.json",
    "enterprise-import-report.schema.json",
    "enterprise-mapping-review.schema.json",
    "enterprise-reimport-diff.schema.json",
    "enterprise-reimport-merge-plan.schema.json",
    "enterprise-topology-projection.schema.json",
    "fault-pack.schema.json",
    "fault-overlay.schema.json",
    "fault-generation-plan.schema.json",
    "layout.schema.json",
    "package-manifest.schema.json",
    "save-state.schema.json",
    "catalog.schema.json",
    "troubleshooting-notebook.schema.json",
    "troubleshooting-session.schema.json",
]
CASES=[
 ("scenario-source.schema.json","valid/scenario-source.json",True),
 ("scenario-source.schema.json","valid/scenario-source-profile.json",True),
 ("scenario-source.schema.json","valid/scenario-source-notes.json",True),
 ("scenario-source.schema.json","valid/scenario-source-enterprise-origin.json",True),
 ("scenario-source.schema.json","valid/scenario-source-fault-origin.json",True),
 ("scenario-source.schema.json","valid/scenario-source-troubleshooting-objectives.json",True),
 ("scenario-normalized.schema.json","valid/scenario-normalized.json",True),
 ("scenario-normalized.schema.json","valid/scenario-normalized-notes.json",True),
 ("scenario-normalized.schema.json","valid/scenario-normalized-enterprise-origin.json",True),
 ("scenario-normalized.schema.json","valid/scenario-normalized-fault-origin.json",True),
 ("scenario-normalized.schema.json","valid/scenario-normalized-troubleshooting-objectives.json",True),
 ("enterprise-baseline.schema.json","valid/enterprise-baseline.json",True),
 ("enterprise-mapping-profile.schema.json","valid/enterprise-mapping-profile.json",True),
 ("enterprise-import-report.schema.json","valid/enterprise-import-report.json",True),
 ("enterprise-mapping-review.schema.json","valid/enterprise-mapping-review.json",True),
 ("enterprise-reimport-diff.schema.json","valid/enterprise-reimport-diff.json",True),
 ("enterprise-reimport-merge-plan.schema.json","valid/enterprise-reimport-merge-plan.json",True),
 ("enterprise-topology-projection.schema.json","valid/enterprise-topology-projection.json",True),
 ("fault-pack.schema.json","valid/fault-pack.json",True),
 ("fault-overlay.schema.json","valid/fault-overlay.json",True),
 ("fault-generation-plan.schema.json","valid/fault-generation-plan.json",True),
 ("layout.schema.json","valid/layout.json",True),
 ("package-manifest.schema.json","valid/package-manifest.json",True),
 ("save-state.schema.json","valid/save-state.json",True),
 ("troubleshooting-notebook.schema.json","valid/troubleshooting-notebook.json",True),
 ("troubleshooting-notebook.schema.json","valid/troubleshooting-notebook-remediation.json",True),
 ("troubleshooting-notebook.schema.json","valid/troubleshooting-notebook-typed-remediation.json",True),
 ("troubleshooting-session.schema.json","valid/troubleshooting-session.json",True),
 ("scenario-source.schema.json","invalid/source-unknown-field.json",False),
 ("scenario-source.schema.json","invalid/source-bad-id.json",False),
 ("scenario-source.schema.json","invalid/source-note-empty.json",False),
 ("scenario-source.schema.json","invalid/source-troubleshooting-objective-bad-order.json",False),
 ("package-manifest.schema.json","invalid/manifest-traversal.json",False),
 ("save-state.schema.json","invalid/save-bad-truth.json",False),
 ("troubleshooting-notebook.schema.json","invalid/troubleshooting-notebook-bad-sequence.json",False),
 ("troubleshooting-notebook.schema.json","invalid/troubleshooting-notebook-remediation-extra-field.json",False),
 ("troubleshooting-notebook.schema.json","invalid/troubleshooting-notebook-typed-remediation-bad-action.json",False),
 ("troubleshooting-session.schema.json","invalid/troubleshooting-session-extra-field.json",False),
 ("enterprise-baseline.schema.json","invalid/enterprise-unknown-with-value.json",False),
 ("enterprise-baseline.schema.json","invalid/enterprise-bad-source-id-shape.json",False),
 ("enterprise-mapping-profile.schema.json","invalid/enterprise-mapping-bad-class.json",False),
 ("enterprise-import-report.schema.json","invalid/enterprise-import-report-extra-field.json",False),
 ("enterprise-mapping-review.schema.json","invalid/enterprise-mapping-review-bad-status.json",False),
 ("enterprise-reimport-diff.schema.json","invalid/enterprise-reimport-diff-bad-kind.json",False),
 ("enterprise-reimport-merge-plan.schema.json","invalid/enterprise-reimport-merge-plan-bad-decision.json",False),
 ("enterprise-topology-projection.schema.json","invalid/enterprise-topology-projection-bad-status.json",False),
 ("fault-pack.schema.json","invalid/fault-pack-bad-mutation.json",False),
 ("fault-overlay.schema.json","invalid/fault-overlay-bad-mode.json",False),
 ("fault-generation-plan.schema.json","invalid/fault-generation-plan-bad-identity.json",False),
 # These are intentionally schema-valid and must be rejected later by semantic compiler checks.
 ("scenario-source.schema.json","invalid/compiler-missing-capability.json",True),
 ("scenario-source.schema.json","invalid/compiler-unknown-resource.json",True),
 ("scenario-source.schema.json","invalid/compiler-profile-mismatch.json",True),
 ("scenario-source.schema.json","invalid/compiler-version-unavailable.json",True),
 ("scenario-source.schema.json","invalid/compiler-zone-cycle.json",True),
 ("scenario-source.schema.json","invalid/compiler-duplicate-global-id.json",True),
]
failures=[]
for schema_name in SCHEMAS:
    schema=json.loads((ROOT/'schema'/schema_name).read_text())
    Draft202012Validator.check_schema(schema)
    print(f"PASS meta-schema: {schema_name}")

fault_pack_schema=json.loads((ROOT/'schema/fault-pack.schema.json').read_text())
for builtin_fault_path in [
    'fault-packs/builtin/network-core.json',
    'fault-packs/builtin/windows-core.json',
    'fault-packs/builtin/linux-core.json',
]:
    builtin_fault_pack=json.loads((ROOT/builtin_fault_path).read_text())
    builtin_fault_errors=list(Draft202012Validator(fault_pack_schema).iter_errors(builtin_fault_pack))
    if builtin_fault_errors:
        failures.append((builtin_fault_path,[e.message for e in builtin_fault_errors]))
        print(f"FAIL {builtin_fault_path}")
    else:
        print(f"PASS {builtin_fault_path}")

scenario_source_schema=json.loads((ROOT/'schema/scenario-source.schema.json').read_text())
curriculum_sources=sorted((ROOT/'curriculum/builtin/wave1').glob('*.json'))
if len(curriculum_sources) != 8:
    failures.append(("curriculum/builtin/wave1",[f"Expected exactly 8 Wave-1 scenario sources, found {len(curriculum_sources)}."]))
    print(f"FAIL curriculum/builtin/wave1 scenario count: {len(curriculum_sources)}")
else:
    print("PASS curriculum/builtin/wave1 scenario count: 8")
for curriculum_path in curriculum_sources:
    curriculum_doc=json.loads(curriculum_path.read_text())
    curriculum_errors=list(Draft202012Validator(scenario_source_schema).iter_errors(curriculum_doc))
    rel=curriculum_path.relative_to(ROOT).as_posix()
    if curriculum_errors:
        failures.append((rel,[e.message for e in curriculum_errors]))
        print(f"FAIL {rel}")
    else:
        print(f"PASS {rel}")

catalog_schema=json.loads((ROOT/'schema/catalog.schema.json').read_text())
catalog=json.loads((ROOT/'catalog/builtin-catalog.json').read_text())
catalog_errors=list(Draft202012Validator(catalog_schema).iter_errors(catalog))
if catalog_errors:
    failures.append(("catalog/builtin-catalog.json",[e.message for e in catalog_errors]))
    print("FAIL catalog/builtin-catalog.json")
else:
    print("PASS catalog/builtin-catalog.json")

neighbor_schema_fixture=json.loads((ROOT/'tests/fixtures/valid/scenario-source.json').read_text())
neighbor_resource=next(resource for resource in neighbor_schema_fixture['resources'] if resource['id']=='firewall01')
neighbor_resource['interfaces']=[{'id':'lan0','label':'LAN','addresses':['10.20.0.1/24'],'mac':'02:00:00:00:20:01'}]
neighbor_resource['properties']['neighbors']=[{
    'id':'rds-neighbor','targetResourceId':'rds01','protocol':'ARP','address':'10.20.0.10',
    'mac':'02:00:00:00:20:10','interface':'lan0','state':'REACHABLE',
}]
neighbor_errors=list(Draft202012Validator(scenario_source_schema).iter_errors(neighbor_schema_fixture))
if neighbor_errors:
    failures.append(('inline-valid-neighbor-state',[e.message for e in neighbor_errors]))
    print('FAIL inline valid ARP/ND state')
else:
    print('PASS inline valid ARP/ND state')
invalid_neighbor_fixture=copy.deepcopy(neighbor_schema_fixture)
next(resource for resource in invalid_neighbor_fixture['resources'] if resource['id']=='firewall01')['properties']['neighbors'][0]['state']='MAGIC'
invalid_neighbor_errors=list(Draft202012Validator(scenario_source_schema).iter_errors(invalid_neighbor_fixture))
if not invalid_neighbor_errors:
    failures.append(('inline-invalid-neighbor-state',['Invalid neighbor state unexpectedly passed schema validation.']))
    print('FAIL inline invalid ARP/ND state')
else:
    print('PASS inline invalid ARP/ND state rejected')

mac_schema_fixture=copy.deepcopy(neighbor_schema_fixture)
mac_switch={
    'id':'sw_schema','type':'network.switch','label':'SW schema',
    'interfaces':[{'id':'p1','label':'p1','addresses':[]},{'id':'p2','label':'p2','addresses':[]}],
    'properties':{'macTable':[{'id':'m1','mac':'02:00:00:00:00:10','interface':'p1'},{'id':'m2','mac':'02:00:00:00:00:20','interface':'p2','vlan':20}]},
    'asset':{'id':'network.switch','version':'1.0.0'},
}
mac_schema_fixture['resources'].append(mac_switch)
mac_errors=list(Draft202012Validator(scenario_source_schema).iter_errors(mac_schema_fixture))
if mac_errors:
    failures.append(('inline-valid-mac-table',[e.message for e in mac_errors]))
    print('FAIL inline valid MAC/CAM table')
else:
    print('PASS inline valid MAC/CAM table')
invalid_mac_fixture=copy.deepcopy(mac_schema_fixture)
next(resource for resource in invalid_mac_fixture['resources'] if resource['id']=='sw_schema')['properties']['macTable'][0]['mac']='not-a-mac'
invalid_mac_errors=list(Draft202012Validator(scenario_source_schema).iter_errors(invalid_mac_fixture))
if not invalid_mac_errors:
    failures.append(('inline-invalid-mac-table',['Invalid MAC table entry unexpectedly passed schema validation.']))
    print('FAIL inline invalid MAC/CAM table')
else:
    print('PASS inline invalid MAC/CAM table rejected')

switchport_schema_fixture=copy.deepcopy(mac_schema_fixture)
switchport_resource=next(resource for resource in switchport_schema_fixture['resources'] if resource['id']=='sw_schema')
switchport_resource['interfaces'][0]['switchport']={'mode':'access','accessVlan':10}
switchport_resource['interfaces'][1]['switchport']={'mode':'trunk','allowedVlans':[10,20],'nativeVlan':10}
switchport_errors=list(Draft202012Validator(scenario_source_schema).iter_errors(switchport_schema_fixture))
if switchport_errors:
    failures.append(('inline-valid-switchports',[e.message for e in switchport_errors]))
    print('FAIL inline valid VLAN access/trunk switchports')
else:
    print('PASS inline valid VLAN access/trunk switchports')

for label, mutation in [
    ('access-missing-vlan', {'mode':'access'}),
    ('trunk-empty-allowed', {'mode':'trunk','allowedVlans':[]}),
    ('unsupported-mode', {'mode':'hybrid','accessVlan':10}),
]:
    invalid_switchport_fixture=copy.deepcopy(switchport_schema_fixture)
    next(resource for resource in invalid_switchport_fixture['resources'] if resource['id']=='sw_schema')['interfaces'][0]['switchport']=mutation
    invalid_switchport_errors=list(Draft202012Validator(scenario_source_schema).iter_errors(invalid_switchport_fixture))
    if not invalid_switchport_errors:
        failures.append((f'inline-invalid-switchport-{label}',['Invalid switchport unexpectedly passed schema validation.']))
        print(f'FAIL inline invalid VLAN switchport {label}')
    else:
        print(f'PASS inline invalid VLAN switchport {label} rejected')

semantic_switchport_fixture=copy.deepcopy(switchport_schema_fixture)
next(resource for resource in semantic_switchport_fixture['resources'] if resource['id']=='sw_schema')['interfaces'][0]['switchport']={'mode':'trunk','allowedVlans':[10],'nativeVlan':20}
semantic_switchport_errors=list(Draft202012Validator(scenario_source_schema).iter_errors(semantic_switchport_fixture))
if semantic_switchport_errors:
    failures.append(('inline-structural-native-vlan',['Cross-field nativeVlan membership should remain an Engine semantic check, but schema rejected the structurally valid object.']))
    print('FAIL inline structural native VLAN contract')
else:
    print('PASS inline structural native VLAN contract; Engine owns native-in-allowed semantic validation')

normalized_schema=json.loads((ROOT/'schema/scenario-normalized.schema.json').read_text())
normalized_switchport_fixture=json.loads((ROOT/'tests/fixtures/valid/scenario-normalized.json').read_text())
normalized_switchport_fixture['resources'].append({
    'id':'sw_vlan_normalized','type':'network.switch','label':'SW VLAN normalized',
    'interfaces':[
        {'id':'p1','label':'p1','addresses':[],'switchport':{'mode':'access','accessVlan':10}},
        {'id':'p2','label':'p2','addresses':[],'switchport':{'mode':'trunk','allowedVlans':[10,20],'nativeVlan':10}},
    ],
    'properties':{},'asset':{'id':'network.switch','version':'1.0.0'},
})
normalized_switchport_errors=list(Draft202012Validator(normalized_schema).iter_errors(normalized_switchport_fixture))
if normalized_switchport_errors:
    failures.append(('inline-valid-normalized-switchports',[e.message for e in normalized_switchport_errors]))
    print('FAIL inline valid normalized VLAN switchports')
else:
    print('PASS inline valid normalized VLAN switchports')

stp_schema_fixture=copy.deepcopy(switchport_schema_fixture)
stp_resource=next(resource for resource in stp_schema_fixture['resources'] if resource['id']=='sw_schema')
stp_resource['properties']['stp']={'protocol':'RSTP','bridgeId':'32768.020000000001','rootBridgeId':'32768.020000000099','rootPathCost':4}
stp_resource['properties']['stpPorts']=[
    {'interface':'p1','role':'ROOT','state':'FORWARDING','bpdu':'RECEIVE'},
    {'interface':'p2','role':'ALTERNATE','state':'DISCARDING','bpdu':'SEND'},
]
stp_errors=list(Draft202012Validator(scenario_source_schema).iter_errors(stp_schema_fixture))
if stp_errors:
    failures.append(('inline-valid-stp-state',[e.message for e in stp_errors]))
    print('FAIL inline valid STP/BPDU state')
else:
    print('PASS inline valid STP/BPDU state')

for label,path,value in [
    ('unsupported-port-state',('stpPorts',0,'state'),'FORWARD'),
    ('unsupported-bpdu',('stpPorts',1,'bpdu'),'TRANSMIT'),
    ('negative-root-cost',('stp','rootPathCost'),-1),
]:
    invalid_stp_fixture=copy.deepcopy(stp_schema_fixture)
    properties=next(resource for resource in invalid_stp_fixture['resources'] if resource['id']=='sw_schema')['properties']
    if path[0]=='stpPorts':
        properties[path[0]][path[1]][path[2]]=value
    else:
        properties[path[0]][path[1]]=value
    invalid_stp_errors=list(Draft202012Validator(scenario_source_schema).iter_errors(invalid_stp_fixture))
    if not invalid_stp_errors:
        failures.append((f'inline-invalid-stp-{label}',['Invalid STP state unexpectedly passed schema validation.']))
        print(f'FAIL inline invalid STP state {label}')
    else:
        print(f'PASS inline invalid STP state {label} rejected')

normalized_stp_fixture=copy.deepcopy(normalized_switchport_fixture)
normalized_stp_resource=next(resource for resource in normalized_stp_fixture['resources'] if resource['id']=='sw_vlan_normalized')
normalized_stp_resource['properties']={
    'stp':{'protocol':'STP','bridgeId':'root','rootBridgeId':'root','rootPathCost':0},
    'stpPorts':[
        {'interface':'p1','role':'DESIGNATED','state':'FORWARDING','bpdu':'SEND'},
        {'interface':'p2','role':'DESIGNATED','state':'FORWARDING','bpdu':'SEND'},
    ],
}
normalized_stp_errors=list(Draft202012Validator(normalized_schema).iter_errors(normalized_stp_fixture))
if normalized_stp_errors:
    failures.append(('inline-valid-normalized-stp-state',[e.message for e in normalized_stp_errors]))
    print('FAIL inline valid normalized STP/BPDU state')
else:
    print('PASS inline valid normalized STP/BPDU state')


# Phase 89: conntrack/session snapshot schema contract.
conntrack_schema_fixture=json.loads((ROOT/'tests/fixtures/valid/scenario-source.json').read_text())
conntrack_fw=next(resource for resource in conntrack_schema_fixture['resources'] if resource['id']=='firewall01')
conntrack_fw['properties']['conntrack']={
    'complete':True,
    'entries':[
        {'id':'ct-rdp','source':'198.51.100.10','destination':'rds01','protocol':'tcp','port':3389,'state':'ESTABLISHED'},
        {'id':'ct-icmp','enabled':False,'source':'198.51.100.20','destination':'rds01','protocol':'icmp','state':'NEW'},
    ],
}
conntrack_errors=list(Draft202012Validator(scenario_source_schema).iter_errors(conntrack_schema_fixture))
if conntrack_errors:
    failures.append(('inline-valid-conntrack',[e.message for e in conntrack_errors]))
    print('FAIL inline valid conntrack/session table')
else:
    print('PASS inline valid conntrack/session table')

for label, mutation in [
    ('unsupported-state', {'id':'ct-bad','source':'198.51.100.10','destination':'rds01','protocol':'tcp','port':3389,'state':'CLOSED'}),
    ('extra-field', {'id':'ct-bad','source':'198.51.100.10','destination':'rds01','protocol':'tcp','port':3389,'state':'ESTABLISHED','guessed':True}),
    ('bad-port', {'id':'ct-bad','source':'198.51.100.10','destination':'rds01','protocol':'tcp','port':70000,'state':'ESTABLISHED'}),
]:
    invalid_conntrack_fixture=copy.deepcopy(conntrack_schema_fixture)
    next(resource for resource in invalid_conntrack_fixture['resources'] if resource['id']=='firewall01')['properties']['conntrack']['entries']=[mutation]
    invalid_conntrack_errors=list(Draft202012Validator(scenario_source_schema).iter_errors(invalid_conntrack_fixture))
    if not invalid_conntrack_errors:
        failures.append((f'inline-invalid-conntrack-{label}',['Invalid conntrack entry unexpectedly passed schema validation.']))
        print(f'FAIL inline invalid conntrack {label}')
    else:
        print(f'PASS inline invalid conntrack {label} rejected')

normalized_conntrack_fixture=json.loads((ROOT/'tests/fixtures/valid/scenario-normalized.json').read_text())
normalized_fw=next(resource for resource in normalized_conntrack_fixture['resources'] if resource['id']=='firewall01')
normalized_fw['properties']['conntrack']={
    'complete':False,
    'entries':[{'id':'ct-http','source':'198.51.100.30','destination':'rds01','protocol':'tcp','port':3389,'state':'UNKNOWN'}],
}
normalized_conntrack_errors=list(Draft202012Validator(normalized_schema).iter_errors(normalized_conntrack_fixture))
if normalized_conntrack_errors:
    failures.append(('inline-valid-normalized-conntrack',[e.message for e in normalized_conntrack_errors]))
    print('FAIL inline valid normalized conntrack/session table')
else:
    print('PASS inline valid normalized conntrack/session table')

# Phase 90: explicit local-host firewall marker schema contract.
local_firewall_fixture=json.loads((ROOT/'tests/fixtures/valid/scenario-source.json').read_text())
local_firewall_host=next(resource for resource in local_firewall_fixture['resources'] if resource['id']=='rds01')
local_firewall_host['properties']['isFirewall']=True
local_firewall_errors=list(Draft202012Validator(scenario_source_schema).iter_errors(local_firewall_fixture))
if local_firewall_errors:
    failures.append(('inline-valid-local-firewall-marker',[e.message for e in local_firewall_errors]))
    print('FAIL inline valid local host firewall marker')
else:
    print('PASS inline valid local host firewall marker')

invalid_local_firewall_fixture=copy.deepcopy(local_firewall_fixture)
next(resource for resource in invalid_local_firewall_fixture['resources'] if resource['id']=='rds01')['properties']['isFirewall']='yes'
invalid_local_firewall_errors=list(Draft202012Validator(scenario_source_schema).iter_errors(invalid_local_firewall_fixture))
if not invalid_local_firewall_errors:
    failures.append(('inline-invalid-local-firewall-marker',['Non-boolean isFirewall unexpectedly passed schema validation.']))
    print('FAIL inline invalid local host firewall marker')
else:
    print('PASS inline invalid local host firewall marker rejected')

normalized_local_firewall_fixture=json.loads((ROOT/'tests/fixtures/valid/scenario-normalized.json').read_text())
next(resource for resource in normalized_local_firewall_fixture['resources'] if resource['id']=='rds01')['properties']['isFirewall']=True
normalized_local_firewall_errors=list(Draft202012Validator(normalized_schema).iter_errors(normalized_local_firewall_fixture))
if normalized_local_firewall_errors:
    failures.append(('inline-valid-normalized-local-firewall-marker',[e.message for e in normalized_local_firewall_errors]))
    print('FAIL inline valid normalized local host firewall marker')
else:
    print('PASS inline valid normalized local host firewall marker')

# Phase 92: explicit Host Stack process/socket/service schema contract.
host_stack_fixture=json.loads((ROOT/'tests/fixtures/valid/scenario-source.json').read_text())
host_stack_host=next(resource for resource in host_stack_fixture['resources'] if resource['id']=='rds01')
host_stack_host['properties']['hostStack']={
    'complete':True,
    'processes':[{'id':'proc-rdp','name':'svchost.exe','pid':1160,'service':'rdp'}],
    'sockets':[{'id':'sock-rdp','protocol':'tcp','localAddress':'0.0.0.0','localPort':3389,'state':'LISTEN','processId':'proc-rdp','service':'rdp'}],
}
host_stack_errors=list(Draft202012Validator(scenario_source_schema).iter_errors(host_stack_fixture))
if host_stack_errors:
    failures.append(('inline-valid-host-stack',[e.message for e in host_stack_errors]))
    print('FAIL inline valid host stack')
else:
    print('PASS inline valid host stack')

tcp_state_fixture=copy.deepcopy(host_stack_fixture)
tcp_state_host=next(resource for resource in tcp_state_fixture['resources'] if resource['id']=='rds01')
tcp_state_host['properties']['hostStack']['sockets']=[{
    'id':'sock-rdp-session','protocol':'tcp','localAddress':'10.0.0.20','localPort':3389,
    'remoteAddress':'198.51.100.10','remotePort':50000,'state':'SYN_RECEIVED','processId':'proc-rdp','service':'rdp'
}]
tcp_state_errors=list(Draft202012Validator(scenario_source_schema).iter_errors(tcp_state_fixture))
if tcp_state_errors:
    failures.append(('inline-valid-tcp-lifecycle-state',[e.message for e in tcp_state_errors]))
    print('FAIL inline valid TCP lifecycle state')
else:
    print('PASS inline valid TCP lifecycle state')

for label, mutation in [
    ('unsupported-state', {'id':'sock','protocol':'tcp','localAddress':'0.0.0.0','localPort':3389,'state':'MAGIC'}),
    ('bad-port', {'id':'sock','protocol':'tcp','localAddress':'0.0.0.0','localPort':70000,'state':'LISTEN'}),
    ('extra-field', {'id':'sock','protocol':'udp','localAddress':'::1','localPort':53,'state':'BOUND','guessedPid':99}),
]:
    invalid_host_stack_fixture=copy.deepcopy(host_stack_fixture)
    next(resource for resource in invalid_host_stack_fixture['resources'] if resource['id']=='rds01')['properties']['hostStack']['sockets']=[mutation]
    invalid_host_stack_errors=list(Draft202012Validator(scenario_source_schema).iter_errors(invalid_host_stack_fixture))
    if not invalid_host_stack_errors:
        failures.append((f'inline-invalid-host-stack-{label}',['Invalid host-stack socket unexpectedly passed schema validation.']))
        print(f'FAIL inline invalid host stack {label}')
    else:
        print(f'PASS inline invalid host stack {label} rejected')

normalized_host_stack_fixture=json.loads((ROOT/'tests/fixtures/valid/scenario-normalized.json').read_text())
normalized_host=next(resource for resource in normalized_host_stack_fixture['resources'] if resource['id']=='rds01')
normalized_host['properties']['hostStack']={
    'complete':False,
    'processes':[{'id':'proc-rdp','name':'svchost.exe','service':'rdp'}],
    'sockets':[{'id':'sock-rdp','protocol':'tcp','localAddress':'127.0.0.1','localPort':3389,'state':'LISTEN','processId':'proc-rdp','service':'rdp'}],
}
normalized_host_stack_errors=list(Draft202012Validator(normalized_schema).iter_errors(normalized_host_stack_fixture))
if normalized_host_stack_errors:
    failures.append(('inline-valid-normalized-host-stack',[e.message for e in normalized_host_stack_errors]))
    print('FAIL inline valid normalized host stack')
else:
    print('PASS inline valid normalized host stack')

for schema_name,fixture_name,expected in CASES:
    schema=json.loads((ROOT/'schema'/schema_name).read_text())
    fixture=json.loads((ROOT/'tests/fixtures'/fixture_name).read_text())
    errors=sorted(Draft202012Validator(schema).iter_errors(fixture), key=lambda e:list(e.path))
    actual=not errors
    print(f"{'PASS' if actual==expected else 'FAIL'} {fixture_name}: expected={'valid' if expected else 'invalid'} actual={'valid' if actual else 'invalid'}")
    if actual!=expected:
        failures.append((fixture_name,[e.message for e in errors]))
if failures:
    for f,errs in failures: print(f,errs)
    raise SystemExit(1)
print(f"PASS schema suite: {len(CASES)}/{len(CASES)} fixture expectations met; {len(SCHEMAS)}/{len(SCHEMAS)} schemas pass Draft 2020-12 meta-validation.")
