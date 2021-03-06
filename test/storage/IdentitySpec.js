'use strict';

const chai = require('chai'),
  chaiAsPromised = require('chai-as-promised'),
  rewire = require('rewire'),
  path = require('path');

chai.use(chaiAsPromised);

describe('FSidentity', () => {
  const fakeToken = 'a1fdb0e8-04bb-4a32-9a26-e20dba8a2a24';
  let identity;

  beforeEach(() => {
    const mockUtils = { storagePath: path.join(__dirname, 'dbMock') };
    const DB = rewire('../../storage/FS/DB');
    DB.__set__('utils', mockUtils);
    const IdentityRewire = rewire('../../storage/FS/Identity');
    IdentityRewire.__set__('DB', DB.default);
    identity = new IdentityRewire.Identity();
  });

  it(`should return self user info`, () => {
    var expectedResult = ['nrpuser', 'admin'];

    return identity.getUsersList().should.eventually.deep.equal(expectedResult);
  });

  it(`should return self user info`, () => {
    return identity.getUserInfo('me', fakeToken).should.eventually.deep.equal({
      id: 'nrpuser',
      displayName: 'nrpuser'
    });
  });

  it(`should return a rejection on getUniqueIdentifier`, () => {
    return identity.getUniqueIdentifier('fakeToken').should.be.eventually
      .rejected;
  });
  it(`should return specific user info`, () => {
    return identity
      .getUserInfo('nrpuser', fakeToken)
      .should.eventually.deep.equal({ id: 'nrpuser', displayName: 'nrpuser' });
  });

  it(`should return a rejection when user is not found`, () => {
    return identity.getUserInfo('fakeuser', fakeToken).should.be.eventually
      .rejected;
  });

  it(`should return default groups`, () => {
    return identity
      .getUserGroups()
      .should.eventually.deep.equal([{ name: 'hbp-sp10-user-edit-rights' }]);
  });

  it(`should return the default group plus admin group`, () => {
    let expectedGroup = [
      { name: 'hbp-sp10-user-edit-rights' },
      { name: 'hbp-sp10-administrators' }
    ];
    return identity
      .getUserGroups(fakeToken, 'admin')
      .should.eventually.deep.equal(expectedGroup);
  });
});

describe('Collabidentity', () => {
  const nock = require('nock');
  const fakeToken = 'a1fdb0e8-04bb-4a32-9a26-e20dba8a2a24';
  const IdentityRewire = rewire('../../storage/Collab/Identity');

  let identity;

  beforeEach(() => {
    identity = new IdentityRewire.Identity();
  });

  it(`should return self user info`, () => {
    const response = {
      id: 'default-owner',
      displayName: 'nrpuser'
    };

    nock('https://services.humanbrainproject.eu')
      .get('/idm/v1/api/user/me')
      .reply(200, response);

    return identity
      .getUserInfo('me', fakeToken)
      .should.eventually.deep.equal(response);
  });

  it(`should return id on getUniqueIdentifier`, () => {
    const response = {
      id: 'default-owner',
      displayName: 'nrpuser'
    };

    nock('https://services.humanbrainproject.eu')
      .get('/idm/v1/api/user/me')
      .reply(200, response);

    return identity
      .getUniqueIdentifier('sometoken')
      .should.eventually.equal(response.id);
  });

  it(`should return default groups`, () => {
    const groups = [{ name: 'hbp-sp10-user-edit-rights' }],
      response = {
        _embedded: { groups: groups }
      };

    nock('https://services.humanbrainproject.eu')
      .get('/idm/v1/api/user/me/member-groups?page=0&pageSize=1000')
      .reply(200, response);

    return identity.getUserGroups().should.eventually.deep.equal(groups);
  });
});
