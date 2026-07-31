import re

with open('/opt/saas/server/index.js', 'r') as f:
    content = f.read()

# 1. Fix the sip-provision endpoint
start_marker = '// Download provisioning XML content directly'
end_marker = '    });\n  } catch (error) {\n    if (error instanceof FlexisipAccountManagerError'

start_idx = content.find(start_marker)
end_idx = content.find(end_marker)

if start_idx >= 0 and end_idx > start_idx:
    replacement = '''// Download provisioning XML and save to a local file (tokens are one-time-use)
    // Return a server-hosted URL so the app can use core.provisioningUri (same as QR login)
    const fs = require("fs");
    const path = require("path");
    const crypto = require("crypto");
    let provisionXml = null;
    try {
      const xmlResponse = await fetch(provisionUrl);
      if (xmlResponse.ok) {
        provisionXml = await xmlResponse.text();
      }
    } catch (xmlError) {
      console.error("[auth/sip-provision] Failed to download XML: " + (xmlError.message || xmlError));
    }

    if (!provisionXml) {
      return response.status(502).json({ success: false, message: "無法下載 provisioning 配置文件。" });
    }

    // Save to a static file and return its URL
    const provDir = "/tmp/provisioning";
    if (!fs.existsSync(provDir)) fs.mkdirSync(provDir, { recursive: true });
    const fileId = crypto.randomBytes(12).toString("hex");
    const fileName = username + "_" + fileId + ".xml";
    const filePath = path.join(provDir, fileName);
    fs.writeFileSync(filePath, provisionXml, "utf8");

    // Schedule cleanup after 10 minutes
    setTimeout(function() { try { fs.unlinkSync(filePath); } catch(e) {} }, 600000);

    const appProvisionUrl = "http://127.0.0.1:3001/api/provisioning/" + fileName;

    return response.json({
      success: true,
      data: {
        provisionUrl: appProvisionUrl,
        username,
        domain,
      },
    });'''

    content = content[:start_idx] + replacement + '\n' + content[end_idx:]
    print('Step 1: sip-provision endpoint updated')
else:
    print('Step 1 FAILED: start=' + str(start_idx) + ' end=' + str(end_idx))

# 2. Add static file serving endpoint for provisioning XML files
static_route = '''
// GET /api/provisioning/:file - Serve downloaded provisioning XML files
app.get("/api/provisioning/:file", (request, response) => {
  const file = String(request.params.file || "").replace(/[^a-zA-Z0-9_.-]/g, "");
  const filePath = "/tmp/provisioning/" + file;
  try {
    if (require("fs").existsSync(filePath)) {
      response.setHeader("Content-Type", "application/xml");
      response.sendFile(filePath);
    } else {
      response.status(404).type("text/plain").send("Not found");
    }
  } catch (e) {
    response.status(404).type("text/plain").send("Not found");
  }
});
'''

# Find a good insertion point - after the sip-provision endpoint
insert_marker = '// POST /api/auth/change-password'
insert_idx = content.find(insert_marker)
if insert_idx >= 0:
    content = content[:insert_idx] + static_route + '\n' + content[insert_idx:]
    print('Step 2: Static file endpoint added')
else:
    print('Step 2 FAILED: insert marker not found')

with open('/opt/saas/server/index.js', 'w') as f:
    f.write(content)
print('Done - file written')
