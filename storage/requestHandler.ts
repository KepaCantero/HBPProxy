/**---LICENSE-BEGIN - DO NOT CHANGE OR MOVE THIS HEADER
 * This file is part of the Neurorobotics Platform software
 * Copyright (C) 2014,2015,2016,2017 Human Brain Project
 * https://www.humanbrainproject.eu
 *
 * The Human Brain Project is a European Commission funded project
 * in the frame of the Horizon2020 FET Flagship plan.
 * http://ec.europa.eu/programmes/horizon2020/en/h2020-section/fet-flagships
 *
 * This program is free software; you can redistribute it and/or
 * modify it under the terms of the GNU General Public License
 * as published by the Free Software Foundation; either version 2
 * of the License, or (at your option) any later version.
 *
 * This program is distributed in the hope that it will be useful,
 * but WITHOUT ANY WARRANTY; without even the implied warranty of
 * MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE.  See the
 * GNU General Public License for more details.
 *
 * You should have received a copy of the GNU General Public License
 * along with this program; if not, write to the Free Software
 * Foundation, Inc., 51 Franklin Street, Fifth Floor, Boston, MA  02110-1301, USA.
 * ---LICENSE-END**/
'use strict';

import { File } from './BaseStorage';
import CustomModelService from './CustomModelsService';
import * as ExperimentCloner from './ExperimentCloner';

// test mocked
// tslint:disable: prefer-const
let { TemplateExperimentCloner, NewExperimentCloner } = ExperimentCloner,
  GDPR = require('./GDPR').default;
// tslint:enable: prefer-const

const q = require('q'),
  path = require('path');

// mocked on unit tests
// tslint:disable-next-line: prefer-const
let customModelService = new CustomModelService();

const gdprService = new GDPR();

export default class RequestHandler {
  private authenticator;
  private storage;
  private identity;
  private customModelService;
  private tokenIdentifierCache;
  private newExperimentPath;

  constructor(private config) {
    try {
      if (!config.storage) throw `'storage' key missing in the config file`;
      if (!config.authentication)
        throw `'authentication' key missing in the config file`;

      this.loadDependenciesInjection();

      this.customModelService = new CustomModelService();
      this.tokenIdentifierCache = new Map();
      this.newExperimentPath = path.join('template_new', 'TemplateNew.exc');
    } catch (e) {
      console.error('Failed to instantiate storage implementation', e);
    }
  }

  async loadDependenciesInjection() {
    try {
      const storageBasePath = path.resolve(
        path.join(__dirname, this.config.storage)
      );
      const authenticationBasePath = path.resolve(
        path.join(__dirname, this.config.authentication)
      );

      const { Storage } = await import(path.join(storageBasePath, 'Storage'));
      const { Authenticator } = await import(path.join(
        authenticationBasePath,
        'Authenticator'
      ));
      const { Identity } = await require(path.join(
        authenticationBasePath,
        'Identity'
      ));

      this.authenticator = new Authenticator(this.config);
      this.storage = new Storage(this.config);
      this.identity = new Identity(this.config);
    } catch (ex) {
      console.error(`Impossible to lazy load injected dependencies:
${ex.stack}`);
      process.exit(1);
    }
  }

  authenticate(usr, pwd) {
    return this.authenticator.login(usr, pwd);
  }

  async getGDPRStatus(token) {
    const userId = await this.getUserIdentifier(token);
    const gdpr = await gdprService.getUserAcceptedGDPR(userId);
    return { gdpr };
  }

  async acceptGDPRStatus(token) {
    const userId = await this.getUserIdentifier(token);
    return gdprService.setUserAcceptedGDPR(userId);
  }

  async getUserIdentifier(token) {
    if (this.tokenIdentifierCache.has(token))
      return q.when(this.tokenIdentifierCache.get(token));

    const id = await this.identity.getUniqueIdentifier(token);
    this.tokenIdentifierCache.set(token, id);
    return id;
  }

  listFiles(parentDir: string, token: string): Promise<File[]> {
    return this.authenticator
      .checkToken(token)
      .then(() => this.getUserIdentifier(token))
      .then(userId => this.storage.listFiles(parentDir, token, userId));
  }

  async getFile(filename, parentDir, token, byname = false) {
    await this.authenticator.checkToken(token);
    const userId = await this.getUserIdentifier(token);
    return this.storage.getFile(filename, parentDir, token, userId, byname);
  }

  deleteFile(filename, parentDir, token, byname = false) {
    return this.authenticator
      .checkToken(token)
      .then(() => this.getUserIdentifier(token))
      .then(userId =>
        this.storage.deleteFile(filename, parentDir, token, userId, byname)
      );
  }

  deleteExperiment(experimentName, parentDir, token) {
    return this.authenticator
      .checkToken(token)
      .then(() => this.getUserIdentifier(token))
      .then(userId =>
        this.storage.deleteExperiment(experimentName, parentDir, token, userId)
      );
  }

  deleteFolder(filename, parentDir, token, byname = false) {
    return this.authenticator
      .checkToken(token)
      .then(() => this.getUserIdentifier(token))
      .then(userId =>
        this.storage.deleteFolder(filename, parentDir, token, userId, byname)
      );
  }

  createOrUpdate(
    filename,
    fileContent,
    contentType,
    parentDir,
    token,
    append = false
  ) {
    return this.authenticator
      .checkToken(token)
      .then(() => this.getUserIdentifier(token))
      .then(userId =>
        this.storage.createOrUpdate(
          filename,
          fileContent,
          contentType,
          parentDir,
          token,
          userId,
          append
        )
      );
  }

  createFolder(foldername, parentDir, token) {
    return this.authenticator
      .checkToken(token)
      .then(() => this.getUserIdentifier(token))
      .then(userId =>
        this.storage.createFolder(foldername, parentDir, token, userId)
      );
  }

  async listExperiments(token, contextId, options = { filter: undefined }) {
    const SPECIAL_FOLDERS = new Set(['robots', 'brains', 'environments']);
    await this.authenticator.checkToken(token);
    const userId = await this.getUserIdentifier(token);
    const privateExps = await this.storage.listExperiments(
      token,
      userId,
      contextId,
      options
    );
    const shared = await this.listExperimentsSharedByUser(token);
    const exps = [
      ...privateExps.map(exp => ({ ...exp, owned: true })),
      ...shared.map(exp => ({ ...exp, owned: false }))
    ];
    return options.filter
      ? exps.filter(e => e.name === options.filter)
      : exps.filter(e => !SPECIAL_FOLDERS.has(e.name));
  }

  addUsertoSharedUserListinExperiment(newExperiment, userId, token) {
    return this.authenticator
      .checkToken(token)
      .then(() =>
        this.storage.addUsertoSharedUserListinExperiment(newExperiment, userId)
      );
  }
  listExperimentsSharedByUser(token) {
    return this.authenticator
      .checkToken(token)
      .then(() => this.getUserIdentifier(token))
      .then(userId => this.storage.listExperimentsSharedByUser(userId));
  }

  createExperiment(newExperiment, token, contextId) {
    return this.authenticator
      .checkToken(token)
      .then(() => this.getUserIdentifier(token))
      .then(userId =>
        this.storage.createExperiment(newExperiment, token, userId, contextId)
      );
  }

  copyExperiment(experiment, token, contextId) {
    return this.authenticator
      .checkToken(token)
      .then(() => this.getUserIdentifier(token))
      .then(userId =>
        this.storage.copyExperiment(experiment, token, userId, contextId)
      );
  }

  getModelPath(type, name, token) {
    return this.authenticator
      .checkToken(token)
      .then(() => this.getUserIdentifier(token))
      .then(userName => this.storage.getModelPath(type, name));
  }

  getModelFolder(type, name, token) {
    return this.authenticator
      .checkToken(token)
      .then(() => this.getUserIdentifier(token))
      .then(() => this.storage.getModelFolder(type, name));
  }

  async deleteCustomModel(modelType, modelName, token) {
    return this.authenticator
      .checkToken(token)
      .then(() => this.getUserIdentifier(token))
      .then(userId => this.storage.deleteCustomModel(modelType, modelName, userId));
  }

  async createCustomModel(model, zipFile) {
    await this.authenticator.checkToken(model.ownerId);
    model.ownerName = await this.getUserIdentifier(model.ownerId);
    return this.storage.createCustomModel(
      model, zipFile
    );
  }

  async getModelConfigFile(modelType, modelName, token) {
    const userModel = await this.getModelFolder(modelType, modelName, token);
    return customModelService.extractFileFromZip(userModel, 'model.config');
  }

  createZip(userName, modelType, zipName, zip) {
    const model = {
      ownerId: userName,
      type: modelType,
      path: path.join(modelType, zipName),
    };
    return customModelService
      .getZipModelMetaData(model, zip)
      .then(modelData =>
        this.createCustomModel(modelData, zip)
      );
  }

  listModelsbyType(customFolder, token) {
    return this.authenticator
      .checkToken(token)
      .then(() => this.getUserIdentifier(token))
      .then(userId =>
        this.storage.listModelsbyType(customFolder)
      );
  }

  async listUserModelsbyType(modelType, token) {
    await this.authenticator.checkToken(token);
    const userId = await this.getUserIdentifier(token);
    const userModels = await this.storage.listUserModelsbyType(modelType, userId);
    const models = await q.all(
      userModels.map(userModel =>
        q.all([userModel, this.getModelFolder(userModel.modelType,
          userModel.fileName,
          token)])
      )
    );
    const metaData = await q.all(
      models.map(([model, data]) =>
        this.customModelService.getZipModelMetaData(
          model,
          data
        )
      ));
    return metaData;
  }

  async unzipCustomModel(modelType, modelName, token) {
    const modelPath = path.join(modelType, modelName);
    const decodedPath = decodeURIComponent(modelPath);
    const parsedModel = {uuid: decodedPath, fileName: decodedPath};
    const userModel = await this.getModelFolder(modelType, modelName, token);
    await customModelService.extractZip(userModel);
    return q.resolve();
  }

  getLoginPage() {
    return this.authenticator.getLoginPage();
  }

  getUserInfo(userId, token) {
    return this.authenticator
      .checkToken(token)
      .then(() => this.identity.getUserInfo(userId, token));
  }

  getUserGroups(token) {
    return this.authenticator
      .checkToken(token)
      .then(() => this.getUserIdentifier(token))
      .then(userId => this.identity.getUserGroups(token, userId));
  }

  getUsersList(token) {
    return this.authenticator
      .checkToken(token)
      .then(() => this.identity.getUsersList(token));
  }

  async cloneExperiment(token, expPath, contextId) {
    await this.authenticator.checkToken(token);
    const userId = await this.getUserIdentifier(token);

    return new TemplateExperimentCloner(
      this.storage,
      this.config
    ).cloneExperiment(token, userId, expPath, contextId, undefined);
  }
  /*shared models*/
  addUsertoSharedUserListinModel(modelType, modelId, userId, token) {
    return this.authenticator
      .checkToken(token)
      .then(() =>
        this.storage.addUsertoSharedUserListinModel(modelType, modelId, userId)
      );
  }

  listSharedUsersbyModel(modelType, modelID, token) {
    return this.authenticator
      .checkToken(token)
      .then(() => this.storage.listSharedUsersbyModel(modelType, modelID));
  }

  updateSharedModelMode(modelType, modelId, sharedValue, token) {
    return this.authenticator
      .checkToken(token)
      .then(() =>
        this.storage.updateSharedModelMode(modelType, modelId, sharedValue)
      );
  }

  getSharedModelMode(modelType, modelID, token) {
    return this.authenticator
      .checkToken(token)
      .then(() => this.storage.getSharedModelMode(modelType, modelID));
  }

  deleteSharedUserFromModel(modeltType, modelId, userId, token) {
    return this.authenticator
      .checkToken(token)
      .then(() =>
        this.storage.deleteSharedUserFromModel(modeltType, modelId, userId)
      )
      .then(res => res);
  }

  deleteSharedUserFromExperiment(experimentId, userId, token) {
    return this.authenticator
      .checkToken(token)
      .then(() =>
        this.storage.deleteSharedUserFromExperiment(experimentId, userId)
      )
      .then(res => res);
  }

  listSharedModels(modelType, token) {
    return this.authenticator
      .checkToken(token)
      .then(() => this.getUserIdentifier(token))
      .then(userId =>
         this.storage.listSharedModels(modelType, userId)
      )
      .then(sharedModels => {
        return q.all(
          sharedModels.map(sharedModel =>
            q.all([sharedModel, this.getModelFolder(sharedModel.modelType, sharedModel.fileName, token)])
          )
        );
      }
      )
      .then(models =>
        q.all(
          models.map(([model, data]) =>
            this.customModelService.getZipModelMetaData(
              model,
              data
            )
          )
        )
      );
  }

  listAllModels(type, token) {
    return this.authenticator
      .checkToken(token)
      .then(() => this.getUserIdentifier(token))
      .then(ownerId =>
        this.storage.listAllModels(type, ownerId ))
      .then(allModels =>
          q.all(
          allModels.map(model =>
              q.all([model, this.getModelFolder(model.type, model.name, token)])
          )
        )
      )
      .then(models =>
        q.all(
          models.map(([model, data]) =>
              this.customModelService.getZipModelMetaData(
                model,
                data
            )
          )
        )
      );
  }
  updateSharedExperimentMode(experimentId, sharedValue, token) {
    return this.authenticator
      .checkToken(token)
      .then(() =>
        this.storage.updateSharedExperimentMode(experimentId, sharedValue)
      );
  }
  getExperimentSharedMode(experimentID, token) {
    return this.authenticator
      .checkToken(token)
      .then(() => this.storage.getExperimentSharedMode(experimentID));
  }

  listSharedUsersbyExperiment(experimentID, token) {
    return this.authenticator
      .checkToken(token)
      .then(() => this.storage.listSharedUsersbyExperiment(experimentID));
  }

  async cloneNewExperiment(token, contextId, environmentPath, defaultName) {
    await this.authenticator.checkToken(token);
    const userId = await this.getUserIdentifier(token);

    return new NewExperimentCloner(
      this.storage,
      this.config,
      environmentPath,
      this.newExperimentPath
    ).cloneExperiment(
      token,
      userId,
      this.newExperimentPath,
      contextId,
      defaultName
    );
  }
}
