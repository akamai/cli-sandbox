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

When creating the sandbox based on a property, the CLI automatically scans the Property Manager configuration, detects all the origins defined in the file and either use the origins from property (`--origin-from property`) or from config file (`--origin-from config`).
Alternatively if you don't provide `--origin-from` command it will ask you to confirm if you want sandbox requests to go directly to origins from property or from config file. This is an example of how the auto scan works:

```
my_laptop:~ username$ akamai sandbox create --property www.example.com:5 --name sandbox_for_example.com --requesthostnames localhost,www.example.com --origin-from config
building origin list 
Detected the following origins: origin-www.example.com  
registering sandbox in local datastore
sandbox_id: 4b3a0c0e-dfe9-4df8-b175-1ed23e293c52 sandbox_for_example.com is now active  
Successfully created sandbox_id 4b3a0c0e-dfe9-4df8-b175-1ed23e293c52. Generated sandbox client configuration at /Users/username/.akamai-cli/cache/sandbox-cli/sandboxes/sandbox_for_example.com/config.json Edit this file to specify the port and host for your dev environment. 
my_laptop:~ username$
``` 


### Step 3: Connect to your sandbox
Run this command to connect securely to the sandbox you just created:

`akamai sandbox start`

You will see this message confirming that you are connected to the sandbox:

`INFO  c.a.devpops.connector.ConnectorMain - Successfully launched Akamai Sandbox Client`

You may also add a `--print-logs` parameter to display logs directly on standard output. 

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

All commands have a built-in help available using `help command`.

> **NOTE**: `sandbox-identifier` is a string that uniquely identifies a sandbox (matches on `name` or `sandboxID`). If you do not specify a `sandbox-identifier`, the CLI uses the currently active sandbox.

optional args `[]`
required args `<>`

```
Usage:  [options] [command]

A tool that makes it easier to manage Akamai Sandboxes. Call the Sandbox API from the command line.

Options:
  -V, --version                                                 Output the current version.
  --debug                                                       Show debug information.
  --edgerc <file>                                               Use edgerc file for authentication.
  --section <name>                                              Use this section in edgerc file that contains the credential set.
  --accountkey <account-id>                                     Use given internal parameter.
  -h, --help                                                    Output usage information.

Commands:
  help [command]                                                Displays help information for the given command.
  install                                                       Downloads and installs the Sandbox Client software.
  list|ls [options]                                             Lists sandboxes that you have managed locally.
  show [sandbox-identifier]                                     Provides details about a sandbox and the JWT expiration date.
  rules [sandbox-identifier]                                    Shows rule tree for sandbox.
  use <sandbox-identifier>                                      Sets the identified sandbox as currently active.
  delete [options] <sandbox-id>                                 Deletes the sandbox.
  update-property [options] <sandbox-id> <sandbox-property-id>  Updates a sandbox-property.
  update [options] [sandbox-identifier]                         Updates a sandbox.
  clone [options] <sandbox-identifier>                          Creates a replica of a given sandbox.
  create [options]                                              Creates a new sandbox.
  start [options]                                               Starts the sandbox client.
  add-property [options] [sandbox-identifier]                   Add a property to a sandbox.
  sync-sandbox [options] <JWT>                                  Sync down a remote sandbox to the local system.
  rotate-jwt [sandbox-identifier]                               Rotate Json Web Token for sandbox.
  add-edgeworker <edgeworker-id> <edgeworker-tarball>           Add edgeworker to the currently active sandbox. The edgeworker-id must be an unsigned integer.
  update-edgeworker <edgeworker-id> <edgeworker-tarball>        Update edgeworker to the currently active sandbox.
  download-edgeworker <edgeworker-id>                           Download edgeworker for the currently active sandbox.
  delete-edgeworker [options] <edgeworker-id>                   Delete edgeworker for the currently active sandbox.
```

### Create Command
```
Usage: akamai-sandbox create [options]

Creates a new sandbox

Options:
  -r, --rules <file>                                      JSON file containing a PAPI rule tree. You need to specify a property or hostname to
                                                          base the sandbox on when using this method.
  -p, --property <property_id | property_name : version>  Property to base the sandbox on. If an active version is not found, the most recent
                                                          version is used.
  -o, --hostname <hostname>                               The hostname of your Akamai property, such as www.example.com.
  -c, --clonable <boolean>                                Make this sandbox clonable.
  -n, --name <string>                                     Name of the sandbox.
  -H, --requesthostnames <string>                         Comma separated list of request hostnames.
  --recipe <path>                                         Path to recipe.json file.
  -C, --cpcode <cpcode>                                   Specify an existing cpcode instead of letting the system generate a new one.
  --origin-from <property | config>                       Redirect origin traffic to the origins defined in your Akamai property or config file.
  -h, --help                                              Output usage information.
```

### Update Command
```
Usage: akamai-sandbox update [options] [sandbox-identifier]

Updates a sandbox.

Options:
  -r, --rules <file>               JSON file containing a PAPI rule tree.
  -c, --clonable <boolean>         Make this sandbox clonable? (Y/N)
  -n, --name <string>              Name of sandbox.
  -H, --requesthostnames <string>  Comma-delimited list of request hostnames within the sandbox.
  --recipe <path>                  Path to `recipe.json` file.
  -h, --help                       Output usage information.

```

### Install Command
```
Usage: akamai-sandbox install [options]

Downloads and installs the Sandbox Client software.

Options:
  -h, --help  Output usage information.
```

### List Command
```
Usage: akamai-sandbox list|ls [options]

Lists sandboxes that you have managed locally.

Options:
  -r, --remote  Show sandboxes from the server.
  -h, --help    Output usage information.
```

### Show Command
```
Usage: akamai-sandbox show [options] [sandbox-identifier]

Provides details about a sandbox.

Options:
  -h, --help  Output usage information.
```

### Rules Command
```
Usage: akamai-sandbox rules [options] [sandbox-identifier]

Shows rule tree for sandbox.

Options:
  -h, --help  Output usage information.
```

### Use Command
```
Usage: akamai-sandbox use [options] <sandbox-identifier>

Sets the identified sandbox as currently active.

Options:
  -h, --help  Output usage information.
```

### Delete Command
```
Usage: akamai-sandbox delete [options] <sandbox-id>

Deletes the sandbox.

Options:
  -f, --force  Attempt to remove the sandbox without prompting for
               confirmation.
  -h, --help   Output usage information.
```

### Clone Command
```
Usage: akamai-sandbox clone [options] <sandbox-identifier>

Creates a replica of a given sandbox.

Options:
  -n, --name <string>                Name of the sandbox.
  --origin-from <property | config>  Redirect origin traffic to the origins
                                     defined in your Akamai property or config
                                     file.
  -h, --help                         Output usage information.
```

### Start Command
```
Usage: akamai-sandbox start [options]

Starts the sandbox client.

Options:
  --print-logs  Print logs to standard output.
  -h, --help    Output usage information.
```

### Add Property Command
```
Usage: akamai-sandbox add-property [options] [sandbox-identifier]

Add a property to a sandbox

Options:
  -r, --rules <file>                                      JSON file containing a PAPI rule tree.
  -p, --property <property_id | property_name : version>  Property to use. If you do not specify a version, the most recent version is used.
  -o, --hostname <hostname>                               The hostname of your Akamai property, such as www.example.com.
  -H, --requesthostnames <string>                         Comma separated list of request hostnames.
  -h, --help                                              Output usage information.
```

### Sync Sandbox Command
```
Usage: akamai-sandbox sync-sandbox [options] <jwtToken>

Sync down a remote sandbox to the local system

Options:
  -n, --name <string>                Recommended to use the sandbox name
                                     provided during creation. If sandbox
                                     folder name already exists locally, custom
                                     sandbox name can be provided.
  --origin-from <property | config>  Redirect origin traffic to the origins
                                     defined in your Akamai property or config
                                     file.
  -h, --help                         Output usage information.
```

### Add Edgeworker Command
```
Usage: akamai-sandbox add-edgeworker [options] <edgeworker-id> <edgeworker-tarball>

Add edgeworker to the currently active sandbox. The edgeworker-id must be an unsigned integer.

Options:
  -h, --help  Output usage information.
```

### Download Edgeworker Command
```
Usage: akamai-sandbox download-edgeworker [options] <edgeworker-id>

Download edgeworker for the currently active sandbox

Options:
  -h, --help  Output usage information.
```

### Delete Edgeworker Command
```
Usage: akamai-sandbox delete-edgeworker [options] <edgeworker-id>

Delete edgeworker for the currently active sandbox

Options:
  -f, --force  Attempt to remove the edgeworker without prompting for
               confirmation.
  -h, --help   Output usage information.
```


## Customizable Template
You can use this example "recipe" to quickly customize the sandbox to your development environment. Copy the code below and paste it into a text editor.

```
{  
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
1. Run this command on your file `akamai sandbox create --recipe=./example/example_recipe.json ` to instantiate the sandbox client according to the defined specifications.

## Resources
For more information on Sandbox, refer to the [User Guide](https://learn.akamai.com/en-us/webhelp/sandbox/sandbox-user-guide/).
