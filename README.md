# Sandbox CLI
The Sandbox command line interface (CLI) expedites the process of creating an isolated development environment for testing changes to your website or property.

## Technical Setup Requirements
To use this tool you need:
* [Akamai CLI](https://github.com/akamai/cli) installed. If you have a Mac with brew installed, run this command: `brew install akamai`.
* An API client that contains both the Sandbox and Property Manager APIs with read-write access. Follow the steps in [Get Started with APIs](https://developer.akamai.com/api/getting-started) to learn how to configure credentials to access the API.
* Node version 8+
* Java version 8+

## Quick Start

### Step 1: Install Sandbox CLI 

`akamai install sandbox`

### Step 2: Create a sandbox 

There are a variety of ways to create a sandbox. These code samples show a few common options.

**Option A**: Create a sandbox based on a hostname in your Akamai property.

`akamai sandbox create --hostname www.example.com --name sandbox_for_example.com`

**Option B**: Create a sandbox based on a Property Manager configuration file.

`akamai sandbox create --property example_prod_pm --name sandbox_for_example.com`

>**NOTE**: This command creates a sandbox based on the version of your Property Manager configuration that is currently active on the production network.

**Option C**: Create a sandbox based on a specific version of a property configuration.

`akamai sandbox create --property example_prod_pm:42 --name sandbox_for_example.com`   

When creating the sandbox based on a property, the CLI automatically scans the Property Manager configuration, detects all the origins defined in the file, and asks you to confirm if you want sandbox requests to go directly to these origins. This is an example of how the auto scan works:

```
my_laptop:~ username$ akamai sandbox create --property www.example.com:5 --name sandbox_for_example.com --requesthostnames localhost,www.example.com
building origin list 
Detected the following origins: origin-www.example.com  
? Would you like the Sandbox Client to proxy these to the destination defined in the Akamai config? **Yes**
registering sandbox in local datastore
sandbox_id: 4b3a0c0e-dfe9-4df8-b175-1ed23e293c52 sandbox_for_example.com is now active  
Successfully created sandbox_id 4b3a0c0e-dfe9-4df8-b175-1ed23e293c52. Generated sandbox client configuration at /Users/username/.akamai-cli/cache/sandbox-cli/sandboxes/sandbox_for_example.com/config.json please edit this file  
my_laptop:~ username$
``` 

### Step 3: Connect to your sandbox
Run this command to connect securely to the sandbox you just created:

`akamai sandbox start`

You will see this message confirming that you are connected to the sandbox:

`INFO  c.a.devpops.connector.ConnectorMain - Successfully launched Akamai Sandbox Client`

### Step 4: Test the Sandbox
You have two options to test the Sandbox.

* Point the hostname associated with the Property Manager configuration to `127.0.0.1` in your `/etc/hosts` file, then access the site from your browser `http://<your-hostname>:9550`.

    OR

* Run this curl command: `curl --header 'Host: www.example.com' http://127.0.0.1:9550/`

### Step 5: Validate that your responses are coming from a Sandbox 
All Sandbox traffic is tagged with the response header `X-Akamai-Sandbox: true`. Use the [Developer Toolkit](https://developer.akamai.com/tools/akamai-developer-toolkit-chrome) to validate the presence of the header.

### Debug and report issues
You are all set, happy debugging! If you experience any issues with Sandbox, raise them as a [github issue](https://github.com/akamai/cli-sandbox/issues). Feel free to create a pull request with the fix or suggestion.
___

## Overview of Commands
Sandbox CLI enables you to manage sandboxes by calling the [Sandbox API](https://developer.akamai.com/api/core_features/sandbox/v1.html).

> **NOTE**: `sandbox-identifier` is a string that uniquely identifies a sandbox (matches on `name` or `sandboxID`). If you do not specify a `sandbox-identifier`, the CLI uses the currently active sandbox.

optional args `[]`
required args `<>`

Usage:  `[options] [command]`

Options:
 
| Syntax | Description |
| - | - |
| -V, --version | Display the version number for the Sandbox CLI program. |
| --debug | Show debug information. |
| --edgerc `<path>` | Use credentials in `edgerc` file for command. (Default file location is _~/.edgerc_) |
| --section `<name>` | Use this section in `edgerc` file. (Default section is _[default]_|
| -h, --help | Display usage information for Sandbox CLI. |
 
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
        "sandboxServerInfo":{  
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

## Resources
For more information on Sandbox, refer to the [User Guide](https://learn.akamai.com/en-us/webhelp/sandbox/sandbox-user-guide/).