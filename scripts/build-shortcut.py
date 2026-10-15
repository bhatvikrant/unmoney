#!/usr/bin/env python3
"""
Builds public/send-to-unmoney.shortcut: an iOS share-sheet Shortcut that posts the shared file
to the user's UnMoney import link (convex/imports.ts). The link is personal, so the shortcut
asks for it once, when it is added ("import question"), instead of having it built in.

Run on a Mac (signing needs macOS and an Apple ID):  python3 scripts/build-shortcut.py
"""
import os
import plistlib
import subprocess
import sys
import tempfile
import uuid

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
OUT = os.path.join(ROOT, "public", "send-to-unmoney.shortcut")

LINK = str(uuid.uuid5(uuid.NAMESPACE_URL, "unmoney/shortcut/link")).upper()
POST = str(uuid.uuid5(uuid.NAMESPACE_URL, "unmoney/shortcut/post")).upper()
OBJ = "￼"  # stands in for a variable inside a text field


def var_text(prefix: str, output_uuid: str, output_name: str) -> dict:
    """Text made of `prefix` followed by another action's output."""
    return {
        "Value": {
            "string": prefix + OBJ,
            "attachmentsByRange": {
                f"{{{len(prefix)}, 1}}": {"Type": "ActionOutput", "OutputUUID": output_uuid, "OutputName": output_name},
            },
        },
        "WFSerializationType": "WFTextTokenString",
    }


actions = [
    # 1. The user's import link, filled in by the import question when the shortcut is added.
    {
        "WFWorkflowActionIdentifier": "is.workflow.actions.gettext",
        "WFWorkflowActionParameters": {"UUID": LINK, "WFTextActionText": ""},
    },
    # 2. POST the shared file to the link. The reply is a sentence for the user.
    {
        "WFWorkflowActionIdentifier": "is.workflow.actions.downloadurl",
        "WFWorkflowActionParameters": {
            "UUID": POST,
            "WFURL": var_text("", LINK, "Text"),
            "WFHTTPMethod": "POST",
            "WFHTTPBodyType": "File",
            "WFRequestVariable": {"Value": {"Type": "ExtensionInput"}, "WFSerializationType": "WFTextTokenAttachment"},
            "ShowHeaders": False,
        },
    },
    # 3. Show what UnMoney said ("Sent to UnMoney…", or why it failed).
    {
        "WFWorkflowActionIdentifier": "is.workflow.actions.showresult",
        "WFWorkflowActionParameters": {"Text": var_text("", POST, "Contents of URL")},
    },
]

shortcut = {
    "WFWorkflowClientVersion": "2605.0.5",
    "WFWorkflowMinimumClientVersion": 900,
    "WFWorkflowMinimumClientVersionString": "900",
    "WFWorkflowName": "Send to UnMoney",
    "WFWorkflowIcon": {"WFWorkflowIconStartColor": 4292093695, "WFWorkflowIconGlyphNumber": 59511},
    "WFWorkflowTypes": ["ActionExtension"],
    "WFWorkflowHasShortcutInputVariables": True,
    "WFWorkflowInputContentItemClasses": ["WFGenericFileContentItem"],
    # Run from the Shortcuts app with nothing shared: ask for a file instead.
    "WFWorkflowNoInputBehavior": {"Name": "WFWorkflowNoInputBehaviorAskForInput", "Parameters": {"ItemClass": "WFGenericFileContentItem"}},
    "WFWorkflowOutputContentItemClasses": [],
    "WFWorkflowImportQuestions": [
        {
            "ActionIndex": 0,
            "Category": "Parameter",
            "ParameterKey": "WFTextActionText",
            "Text": "Paste your import link from UnMoney (More › Import from Money Manager › Copy import link).",
            "DefaultValue": "",
        }
    ],
    "WFWorkflowActions": actions,
    "WFQuickActionSurfaces": [],
}


def main() -> int:
    with tempfile.TemporaryDirectory() as tmp:
        unsigned = os.path.join(tmp, "Send to UnMoney.shortcut")
        with open(unsigned, "wb") as f:
            plistlib.dump(shortcut, f, fmt=plistlib.FMT_BINARY)
        if "--unsigned" in sys.argv:
            os.replace(unsigned, OUT)
            print(f"wrote unsigned {OUT}")
            return 0
        r = subprocess.run(["shortcuts", "sign", "--mode", "anyone", "--input", unsigned, "--output", OUT], capture_output=True, text=True)
        if r.returncode != 0:
            sys.stderr.write(r.stderr or r.stdout)
            return r.returncode
    print(f"wrote {OUT}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
