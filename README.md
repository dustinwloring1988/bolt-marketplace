# bolt-marketplace

[![bolt.diy marketplace: A Marketplace For bolt.diy](./public/cover.png)](https://bolt.diy)

A plugin marketplace for the [bolt.diy](https://github.com/dustinwloring1988/bolt.diy) project.

## Overview

bolt-marketplace is a collection of plugins that extend the functionality of bolt.diy. Plugins are installed via the plugin system and can add tools, utilities, and integrations to your AI-assisted development environment.

## Plugin Structure

Each plugin follows a manifest-based approach with a `manifest.json` file and associated package files. Plugins are identified by their `id` in the format `name.publisher`.

## Demo Plugins

### bolt/demo

**ID**: `bolt.demo`

A demonstration plugin showing how to customize the bolt.diy homepage by hiding example prompts and blank apps.

**Features**:
- `hideExamplePrompts` (toggle): When enabled, hides the example prompt buttons on the homepage
- `hideBlankApps` (toggle): When enabled, hides the blank app starter option on the homepage

**Tools**:
- `count`: Count characters, words, and lines in text
- `transform`: Apply deterministic text transformations

**Settings**:
- `hideExamplePrompts` (toggle, default: true): Hide example prompts on homepage
- `hideBlankApps` (toggle, default: true): Hide blank apps on homepage

### dustinwloring1988/simple

**ID**: `dustinwloring1988.simple`

A simple demonstration plugin for the bolt-marketplace plugin system.

**Features**:
- Basic text counting functionality

**Tools**:
- `count`: Count characters, words, and lines in text

**Settings**:
- `showOnHomepage` (toggle, default: false): Control visibility on homepage

## Installation

Plugins can be installed through the bolt.diy plugin manager or by adding them to the marketplace catalog.

## License

See LICENSE file for details.