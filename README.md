# Sandbox CLI
The Sandbox command line interface (CLI) expedites the process of creating an isolated development environment for testing changes to your website or property.

## Technical Setup Requirements
To use this tool you need:
* [Akamai CLI](https://github.com/akamai/cli) installed. If you have a Mac with brew installed, run this command: `brew install akamai`.
* An API client that contains both the Sandbox and Property Manager APIs with read-write access. Follow the steps in [Get Started with APIs](https://developer.akamai.com/api/getting-started) to learn how to configure credentials to access the API.
* Node versions supported: any active LTS, maintenance LTS and current version (according to [nodejs schedule](https://nodejs.org/en/about/releases/)), currently: 10.x, 12.x, 14.x and 15.x
* Java version 8

## Quick Start

#### Step 1: Install Sandbox CLI 

`akamai install sandbox`

#### Step 2: Create a sandbox 

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
sandbox-id: 4b3a0c0e-dfe9-4df8-b175-1ed23e293c52 sandbox_for_example.com is now active  
Successfully created sandbox-id 4b3a0c0e-dfe9-4df8-b175-1ed23e293c52. Generated sandbox client configuration at /Users/username/.akamai-cli/cache/sandbox-cli/sandboxes/sandbox_for_example.com/config.json Edit this file to specify the port and host for your dev environment. 
my_laptop:~ username$
``` 


#### Step 3: Connect to your sandbox
Run this command to connect securely to the sandbox you just created:

`akamai sandbox start`

You will see this message confirming that you are connected to the sandbox:

`INFO  c.a.devpops.connector.ConnectorMain - Successfully launched Akamai Sandbox Client`

You may also add a `--print-logs` parameter to display logs directly on standard output. 

#### Step 4: Test the Sandbox
You have two options to test the Sandbox.

* Point the hostname associated with the Property Manager configuration to `127.0.0.1` in your `/etc/hosts` file, then access the site from your browser `http://<your-hostname>:9550`.

    OR

* Run this curl command: `curl --header 'Host: www.example.com' http://127.0.0.1:9550/`

#### Step 5: Validate that your responses are coming from a Sandbox 
All Sandbox traffic is tagged with the response header `X-Akamai-Sandbox: true`. You can use e.g. the [Developer Toolkit](https://github.com/akamai/akamai_developer_toolkit) to validate the presence of the header, Network Monitor in any browser or similar tools that display HTTP headers.

#### Debug and report issues
You are all set, happy debugging! If you experience any issues with Sandbox, raise them as a [github issue](https://github.com/akamai/cli-sandbox/issues). Feel free to create a pull request with the fix or suggestion.
___

## Overview of Commands
Sandbox CLI enables you to manage sandboxes by calling the [Sandbox API](https://techdocs.akamai.com/sandbox/reference/welcome-to-sandbox-api).

Every command has a built-in help available by using `--help` or `-h`. Alternatively, you can use `akamai sandbox help [command]` 

Command arguments in `[]` are optional, whereas command arguments in `<>` are required.

> **NOTE**: `sandbox-id` is a string that uniquely identifies a sandbox by `name` or `sandbox-id`. If you don’t specify a `sandbox-id`, the CLI uses the default sandbox. You can set the default with the `use` command.

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
  list|ls [options]                                             Lists sandboxes that are available locally.
  show [sandbox-id]                                             Shows details about the sandbox and JWT expiration date.
  rules [sandbox-id]                                            Shows a rules tree for the sandbox.
  use <sandbox-id>                                              Sets a default sandbox for commands requiring [sandbox-id].
  delete [options] <sandbox-id>                                 Deletes the sandbox.
  update-property [options] <sandbox-id> <sandbox-property-id>  Updates the sandbox’s property.
  update [options] [sandbox-id]                                 Updates the sandbox.
  clone [options] <sandbox-id>                                  Clones the sandbox.
  create [options]                                              Creates a new sandbox.
  start [options]                                               Starts the sandbox client.
  add-property [options] [sandbox-id]                           Adds a property to the sandbox.
  sync-sandbox [options] <JWT>                                  Syncs a remote sandbox with the local system.
  rotate-jwt [sandbox-id]                                       Rotates the JWT for the sandbox.
  add-edgeworker <edgeworker-id> <edgeworker-tarball>           Adds an edgeworker to the default sandbox. Use a positive integer for edgeworker-id.
  update-edgeworker <edgeworker-id> <edgeworker-tarball>        Updates the edgeworker for the default sandbox.
  download-edgeworker <edgeworker-id>                           Downloads the edgeworker for the default sandbox.
  delete-edgeworker [options] <edgeworker-id>                   Deletes the edgeworker for the default sandbox.
```

## Customizable Template
You can use this code sample to quickly customize the sandbox to your development environment. Copy the code below and paste it into a text editor.

```
{
    "sandbox": {
        "clonable": true,
        "properties": [
            {
                "property": "123456:2",
                "requestHostnames": [
                    "localhost2"
                ],
                "cpcode": 1234
            },
            {
                "hostname": "example.com",
                "requestHostnames": [
                    "localhost2"
                ]
            },
            {
                "property": "example.sandbox.property.com:1",
                "rulesPath": "./rules-1.json",
                "requestHostnames": [
                    "localhost3"
                ]
            }
        ]
    },
    "clientConfig": {
        "sandboxServerInfo": {
            "secure": false,
            "port": 9550,
            "host": "127.0.0.1"
        },
        "originMappings": [
            {
                "from": "origin-www.example.com",
                "to": {
                    "secure": false,
                    "port": 8080,
                    "host": "localhost"
                }
            }
        ]
    }
}
```

1. Edit the information for `sandboxServerInfo` and `originMappings` according to your development environment and property specifications. For more information on which fields to modify, refer to the [User Guide](https://techdocs.akamai.com/sandbox/docs/config-sandbox-client-cli).
2. Save the file with a `.json` extension (e.g., `example_recipe.json`)
3. Run this command on your file `akamai sandbox create --recipe=example_recipe.json` to instantiate the sandbox client according to the defined specifications.
