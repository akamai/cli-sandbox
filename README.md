# Akamai Sandbox CLI
The Sandbox CLI is designed to expedite the process of creating an isolated development environment for testing site changes or Akamai property configurations.

## Technical Setup Requirements
In order to use this tool, you must have:
* [Akamai CLI](https://github.com/akamai/cli) installed. If you have a Mac with brew installed, enter `brew install akamai`.
* An API client with both Property Manager API (PAPI) and DevPoPs API with READ-WRITE access. Follow the steps in [Get Started with APIs](https://developer.akamai.com/api/getting-started) to learn how to configure credentials to access the API.
* Node version 8+
* Java version 8+

## Quick Start

### Step 1: Install the Sandbox CLI 

`akamai install sandbox`

### Step 2: Create a Sandbox 

There are multiple ways to create a sandbox. Use these code samples in this Quick Start section for a few common options.

**Option A**: Create a sandbox based on a hostname present in your Akamai Property Manager configuration.

`akamai sandbox create --hostname www.example.com --name sandbox_for_example.com`

**Option B**: Create a sandbox based on a Property Manager file name present on Akamai.

`akamai sandbox create --property example_prod_pm --name sandbox_for_example.com`
>**NOTE**: The above command will create a sandbox based on the latest active version of your Property Manager configuration on production. Use the command below to specify a particular version.
> `akamai sandbox create --property example_prod_pm:42 --name sandbox_for_example.com`   

While creating the sandbox based on a property, the CLI will automatically scan the Property Manager file and detect all the origins defined in the file and ask you if you wish to have the sandbox request go directly to these origins. If you choose "yes" then the sandbox client will pass all the requests directly to the origin as defined in your Property Manager configuration.  Below is an example of how the auto scan works:
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

### Step 3: Connect to the Sandbox
The last stage of the setup is to connect securely to the sandbox you just created. To do this, run the "start" command.

`akamai sandbox start`

Once you are successfully connected to the sandbox, you will see this message:

`INFO  c.a.devpops.connector.ConnectorMain - Successfully launched Akamai Sandbox Connector`   
`INFO  c.a.devpops.connector.ConnectorMain - Connector running on port: 9550`

### Step 4: Test the Sandbox
You have two options to test the Sandbox.

**Option A**: Spoof your hostname to 127.0.0.1

Point the hostname associated with the Property Manager configuration to `127.0.0.1` in your `/etc/hosts` file, then access the site from your browser `http://<your-hostname>:9550`.

OR

**Option B**: Use curl

`curl --header 'Host: www.example.com' http://127.0.0.1:9550/`

### Step 5: Validate that your responses are coming from a Sandbox 
All Sandbox traffic will be tagged with a response header `X-Akamai-Sandbox: true`. Use Chrome developer tools to validate the presence of the header.

### Debug and report issues
You are all set, happy debugging! If you experience any issues with Akamai Sandbox, please raise them as a github issue. Better yet, feel free to place a pull request with the fix or suggestion.
___

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
| --edgerc `<path>` | Use credentials in `edgerc` file for command. (Default file location is _~/.edgerc_) |
| --section `<name>` | Use this section in `edgerc` file. (Default section is _[default]_|
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
