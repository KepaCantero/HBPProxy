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

import { unionWith } from 'lodash';
import Authenticator from '../BaseAuthenticator';
import BaseStorage from '../BaseStorage';

const q = require('q'),
  path = require('path'),
  mime = require('mime-types'),
  USER_DATA_FOLDER = 'USER_DATA';

// mocked in the tests thus non const
// tslint:disable: prefer-const
let DB = require('./DB').default,
  utils = require('./utils').default,
  fs = require('fs'),
  rmdir = require('rmdir'),
  fsExtra = require('fs-extra');
// tslint:enable: prefer-const

export class Storage extends BaseStorage {

  userIdHasAccessToPath(userId, filename) {
    const experiment = filename.split('/')[0];
    return DB.instance.experiments
      .findOne({
        $or: [
          { $and: [{ token: userId, experiment }] },
          { $and: [{ experiment, shared_users: { $in: userId } }] },
          { $and: [{ experiment, shared_option: 'Public' }] }
        ]
      })
      .then(res => res || q.reject(Authenticator.AUTHORIZATION_ERROR));
  }

  calculateFilePath(experiment, filename, model = false) {
    let filePath;
    if (model) {
      filePath = path.join(
        utils.storagePath,
        USER_DATA_FOLDER,
        experiment,
        filename
      );
    } else filePath = path.join(utils.storagePath, filename);
    if (!filePath.startsWith(utils.storagePath))
      // file name attempts at going somewhere else (ie '../../someosfile' or '/usr/someimportantfile')
      return q.reject(Authenticator.AUTHORIZATION_ERROR);
    return filePath;
  }

  listFiles(experiment, token, userId) {
    return this.userIdHasAccessToPath(userId, experiment)
      .then(() => this.calculateFilePath('', experiment))
      .then(fullpath => q.all([fullpath, q.denodeify(fs.readdir)(fullpath)]))
      .then(([fullpath, files]) =>
        files.map(f => {
          const stat = fs.statSync(path.join(fullpath, f));
          return {
            name: f,
            uuid: path.join(experiment, f),
            size: stat.size,
            type: stat.isDirectory() ? 'folder' : 'file',
            modifiedOn: stat.mtime
          };
        })
      );
  }

  getFile(filename, experiment, token, userId, byname) {
    if (byname) filename = path.join(experiment, filename);
    const basename = path.basename(filename);
    return this.userIdHasAccessToPath(userId, filename)
      .then(() => this.calculateFilePath(experiment, filename))
      .then(filePath => q.denodeify(fs.readFile)(filePath))
      .then(filecontent => {
        return {
          uuid: filename,
          contentType: mime.lookup(filename) || 'text/plain',
          contentDisposition: `attachment; filename=${basename}`,
          body: filecontent
        };
      })
      .catch(() =>
        q.reject({ code: 204, msg: `Could not find file ${filename}` })
      );
  }

  deleteFile(filename, experiment, token, userId, byname) {
    if (byname) filename = path.join(experiment, filename);

    return this.userIdHasAccessToPath(userId, filename)
      .then(() => this.calculateFilePath(experiment, filename))
      .then(filePath => q.denodeify(fs.unlink)(filePath))
      .catch(() =>
        q.reject({ code: 204, msg: `Could not find file ${filename}` })
      );
  }

  getCustomModel(modelPath, token, userId) {
    // Unfortunately we have to do that since the backend sends an unparsed json
    if (typeof modelPath !== 'object') modelPath = JSON.parse(modelPath);
    return DB.instance.models
      .findOne({ fileName: modelPath.uuid, token: userId })
      .then(existingExp => {
        if (!existingExp) return q.reject(`The model: ${modelPath.uuid} does not exist in the Models database.`);
        return q
          .resolve(path.join(USER_DATA_FOLDER, modelPath.uuid))
          .then(relFolderName => this.calculateFilePath('', relFolderName))
          .then(folderName => q.denodeify(fs.readFile)(folderName));
      });
  }

  async deleteCustomModel(modelPath, userId): Promise<string> {
    const modelToDelete: { fileName: string, token: string, type: string } | null =
      await DB.instance.models.findOne({ fileName: modelPath, token: userId });
    // if the model is not in the DB (weird) log the problem. At this point we could try to remove it from the FS
    // but maybe this would be undesired behaviour from the user side
    if (!modelToDelete) return q.reject(`The model: ${modelPath} does not exist in the Models database.`);

    let deletionResult: number | null;
    try {
      // remove the custom model from the FS
      await q.denodeify(fs.unlink)(this.calculateFilePath('', path.join(USER_DATA_FOLDER, modelPath)));
      // remove model from DB
      deletionResult = await DB.instance.models.remove({ fileName: modelPath, token: userId });
      if (!deletionResult)
        return q.reject(`Could not delete the model ${modelPath} from the Models database.`);
    } catch {
      // even if the model is not in the FS (cause it could have been manually removed)
      // still try to remove it from the DB
      await DB.instance.models.remove({ fileName: modelPath, token: userId });
      // if the FS call failed we log the problem
      return q.reject(`Could not find the model ${modelPath} to remove in the user storage.`);
    }
    return q.resolve(`Succesfully deleted model ${modelPath} from the user storage.`);
  }

  createCustomModel(modelType, modelData, userId, modelName) {
    const newFileName = path.join(modelType, modelName);
    return DB.instance.models
      .findOne({ fileName: newFileName, token: userId })
      .then(existingExp => {
        if (!existingExp)
          DB.instance.models.insert({
            token: userId,
            fileName: newFileName,
            type: modelType
          });
        return q
          .resolve(this.calculateFilePath(modelType, modelName, true))
          .then(filePath =>
            q.denodeify(fs.writeFile)(filePath, modelData, {
              encoding: 'binary'
            })
          );
      });
  }

  listAllCustomModels(customFolder) {
    return DB.instance.models
      .find({ type: customFolder })
      .then(res =>
        res.map(f => ({
          uuid: f.fileName,
          fileName: f.fileName,
          userId: f.token
        }))
      )
      .catch(() => []);
  }

  listCustomModels(customFolder, token, userId) {
    return DB.instance.models
      .find({ token: userId, type: customFolder })
      .then(res =>
        res.map(f => ({
          uuid: f.fileName,
          fileName: f.fileName
        }))
      )
      .catch(() => []);
  }

  deleteExperiment(foldername, experiment, token, userId) {
    return this.deleteFolder(foldername, experiment, token, userId)
      .then(() => {
        return DB.instance.experiments.remove({
          token: userId,
          experiment
        });
      })
      .then(() => undefined);
  }

  deleteFolder(foldername, experiment, token, userId) {
    return this.userIdHasAccessToPath(userId, foldername)
      .then(() => this.calculateFilePath(experiment, foldername))
      .then(filePath => q.denodeify(rmdir)(filePath));
  }

  createOrUpdate(
    filename,
    fileContent,
    contentType,
    experiment,
    token,
    userId,
    append = false
  ) {
    filename = path.join(experiment, filename);
    return this.userIdHasAccessToPath(userId, filename)
      .then(() => this.calculateFilePath(experiment, filename))
      .then(filePath =>
        fsExtra.ensureDir(path.dirname(filePath)).then(() => filePath)
      )
      .then(
        filePath =>
          append
            ? q.denodeify(fs.appendFile)(filePath, fileContent)
            : q.denodeify(fs.writeFile)(filePath, fileContent)
      );
  }

  createFolder(foldername, experiment, token, userId) {
    const fullFoldername = path.join(experiment, foldername);
    return (
      this.userIdHasAccessToPath(userId, fullFoldername)
        .then(() => this.calculateFilePath(experiment, fullFoldername))
        .then(folderpath => q.denodeify(fs.mkdir)(folderpath))
        // if folder exists no need to throw error
        .catch(err => (err.code === 'EEXIST' ? q.resolve() : q.reject(err)))
        .then(() => ({
          uuid: fullFoldername,
          entity_type: 'folder',
          name: foldername
        }))
    );
  }

  async listExperiments(token, userId, contextId, options = { all: false }): Promise<Array<{ uuid: string, name: string }>> {
    if (options.all) {
      const storageContents: string[] = await q.denodeify(fs.readdir)(utils.storagePath);
      const fsExperiments = storageContents.map(file => ({ uuid: file, name: file }));
      const dbExperiments = (await DB.instance.experiments.find()).map(e => ({uuid: e.experiment, name: e.experiment}));
      return unionWith(
        fsExperiments,
        dbExperiments,
        (exp1, exp2) => exp1.uuid === exp2.uuid
      );

    } else {
      const userExperiments: Array<{ experiment: string }> = await DB.instance.experiments.find({ token: userId });
      return userExperiments.map(e => ({ uuid: e.experiment, name: e.experiment }));
    }
  }

  isDirectory(fileSystemEntry) {
    return fs
      .statSync(path.join(utils.storagePath, fileSystemEntry))
      .isDirectory();
  }

  createExperiment(newExperiment, token, userId) {
    return DB.instance.experiments
      .findOne({ experiment: newExperiment })
      .then(existingExp => {
        if (existingExp) return q.reject('Experiment already exists');

        return DB.instance.experiments
          .insert({ token: userId, experiment: newExperiment })
          .then(() => this.calculateFilePath('', newExperiment))
          .then(filePath => q.denodeify(fs.mkdir)(filePath))
          .then(() => ({ uuid: newExperiment }));
      });
  }

  copyExperiment(experiment, token, userId) {
    return this.listExperiments(token, userId, null, {
      all: true
    }).then(res => {
      const copiedExpName = utils.generateUniqueExperimentId(
        experiment,
        0,
        res.map(exp => exp.name)
      );
      return this.createExperiment(copiedExpName, token, userId)
        .then(() => this.listFiles(experiment, token, userId))
        .then(res =>
          this.copyFolderContents(res, copiedExpName).then(() => ({
            clonedExp: copiedExpName,
            originalExp: experiment
          }))
        );
    });
  }

  getExperimentSharedMode(experimentID) {
    return DB.instance.experiments
      .findOne({ experiment: experimentID })
      .then(res => (res.shared_option ? res.shared_option : 'Private'));
  }

  updateSharedExperimentMode(experimentID, sharedValue) {
    return DB.instance.experiments.update(
      { experiment: experimentID },
      { $set: { shared_option: sharedValue } }
    );
  }

  listSharedUsersbyExperiment(experimentID) {
    return DB.instance.experiments
      .findOne({ experiment: experimentID })
      .then(res => (res.shared_users ? res.shared_users : []));
  }

  listExperimentsSharedByUser(userId) {
    return DB.instance.experiments
      .find({
        $and: [
          {
            shared_option: { $ne: 'Private' },
            $or: [
              { shared_users: { $in: userId } },
              { $and: [{ token: { $ne: userId }, shared_option: 'Public' }] }
            ]
          }
        ]
      })
      .then(res => res.map(f => ({ uuid: f.experiment, name: f.experiment })));
  }

  deleteSharedUserFromExperiment(experimentId, userId) {
    if (userId === 'all')
      return DB.instance.experiments.update(
        { experiment: experimentId },
        { $set: { shared_users: [] } },
        { multi: true }
      );
    else
      return DB.instance.experiments.update(
        { experiment: experimentId },
        { $pull: { shared_users: { $in: [userId] } } }
      );
  }

  addUsertoSharedUserListinExperiment(newExperiment, userId) {
    return DB.instance.experiments
      .findOne({ experiment: newExperiment })
      .then(existingExp => {
        if (existingExp)
          return DB.instance.experiments.update(
            { _id: existingExp._id },
            { $addToSet: { shared_users: userId } }
          );
        return q.reject('Experiment does not exist');
      });
  }

  copyFolderContents(contents, destFolder) {
    return q.all(
      contents.map(item =>
        (item.type === 'folder'
          ? fsExtra.ensureDir(
            this.calculateFilePath('', path.join(destFolder, item.name))
          )
          : q.resolve()
        ).then(() =>
          fsExtra.copy(
            this.calculateFilePath('', item.uuid),
            this.calculateFilePath('', path.join(destFolder, item.name))
          )
        )
      )
    );
  }
}
