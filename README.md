# Akamai Sandbox CLI
The Sandbox CLI is designed to expedite the process of creating an isolated development environment for testing site changes or Akamai property configurations.

## Technical Setup Requirements
In order to use this tool, you must have:
* [Akamai CLI](https://github.com/akamai/cli) installed.
* An API client for the DevPoPs API with READ-WRITE access. Follow the steps in [Get Started with APIs](https://developer.akamai.com/api/getting-started) to learn how to configure credentials to access the API.
* Node version 8+
* Java version 8+

## Overview of Commands
The Sandbox CLI is a tool that enables you to manage Akamai Sandboxes by calling the [Akamai Sandbox API](https://developer.akamai.com/api/core_features/devpops/v1.html).

> **NOTE**: `sandbox-identifier` is a string that can uniquely identify a sandbox (matches on `name` or `sandboxID`). If the sandbox identifier is not specified, it will use the currently active sandbox.

optional args `[]`
required args `<>`

Usage:  `[options] [command]`

Options:
 
| Syntax | Description |
| - | - |
| -V, --version | Display the version number for the Sandbox CLI program. |
| --debug | Show debug information. |
| --edgerc `<path>` | Use credentials in `edgerc` file for command. |
| --section `<name>` | Use this section in `edgerc` file. |
| -h, --help | Display usage information for the Sandbox CLI. |
 
Commands:

| Command | Description |
| - | - |
| help [command] | Display usage information for the given command. |
| install | Download and install the sandbox client software. |
| list, ls [options] | List sandboxes that are available locally. |
| show [sandbox-identifier] | Show details about a sandbox. |
| rules [sandbox-identifier] | Show rule tree for the property within the sandbox. |
| use `<sandbox-identifier>` | Set the identified sandbox as active. |
| delete `<sandbox-identifier>` | Delete the specified sandbox. |
| update-property [options] `<sandbox-id> <sandbox-property-id>` | Update the sandbox property. |
| update [options] [sandbox-identifier] | Update the sandbox. |
| clone [options] `<sandbox-identifier>` | Clone the specified sandbox. |
| create [options] | Create a new sandbox. |
| start | Start the sandbox client. |

### Create Command
Use this command to create a new sandbox.

Usage: `create [options]`

Options:

| Syntax | Description |
| - | - |
| -r, --rules `<file>` | Rule tree associated with the Akamai property. |
| -p, --property `<property_id property_name : version>` | Property to include in the sandbox. If version number is not specified, sandbox will use the current production version. |
| -o, --hostname `<hostname>` | The hostname of your Akamai property (e.g. www.example.com). |
| -c, --clonable `<boolean>` | Indicates whether sandbox can be replicated by other developers. |
| -n, --name `<string>` | Name of sandbox. |
| -H, --requesthostnames `<string>` | Comma-delimited list of request hostnames within the sandbox. |
| --recipe `<path>` | Path to JSON file that includes customizable sandbox templates. |
| -h, --help | Display usage information. |

### Update Command
Use this command to update your sandbox.

Usage: `update [options] [sandbox-identifier]`
 
Options:

| Syntax | Description |
| - | - |
| -r, --rules `<file>` | Rule tree associated with the Akamai property. |
| -c, --clonable `<boolean>` | Indicates whether sandbox can be replicated by other developers. |
| -n, --name `<string>` | Name of sandbox. |
| -H, --requesthostnames `<string>` | Comma-delimited list of request hostnames within the sandbox. |
| --recipe `<path>` | Path to JSON file that includes customizable sandbox templates. |
| -h, --help | Display usage information. |

## Customizable Template
You can use this example "recipe" to quickly customize the sandbox to your development environment. Copy the code below and paste it into a text editor.

```{  
    "sandbox":{  
        "clonable":true,
        "properties":[  
            {  
                "property":"123456:2",
                "requestHostnames":[  
                    "localhost2"
                ]
            },
            {  
                "hostname":"www.example.com",
                "requestHostnames":[  
                    "localhost2"
                ]
            },
            {  
                "rulesPath":"./rules-1.json",
                "requestHostnames":[  
                    "localhost3"
                ]
            }
        ]
    },
    "clientConfig":{  
        "connectorServerInfo":{  
            "secure":false,
            "port":9550,
            "host":"127.0.0.1"
        },
        "originMappings":[  
            {  
                "from":"origin-www.example.com",
                "to":{  
                    "secure":false,
                    "port":8080,
                    "host":"localhost"
                }
            }
        ]
    }
}
```
1. Edit the information according to your development environment and property specifications.
1. Save the file with a `.json` extension (e.g., `example_recipe.json`)
1. Run this command on your file ` ./akamai-sandbox create --recipe=./example/example_recipe.json ` to instantiate the sandbox client according to the defined specifications.