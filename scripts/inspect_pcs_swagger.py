import json
import sys


swagger = json.load(sys.stdin)
operation = swagger["paths"]["/reports/closeout/detail"]["post"]
request_ref = operation["requestBody"]["content"]["application/json"]["schema"]["$ref"]
request_name = request_ref.rsplit("/", 1)[-1]
response_ref = operation["responses"]["200"]["content"]["application/json"]["schema"]["items"]["$ref"]
response_name = response_ref.rsplit("/", 1)[-1]
print(json.dumps({
    "summary": operation.get("summary"),
    "requestSchema": request_name,
    "request": swagger["components"]["schemas"][request_name],
    "responseSchema": response_name,
    "response": swagger["components"]["schemas"][response_name],
    "responses": operation["responses"],
}, indent=2))
