var Promise = require('bluebird');
var _ = require('lodash');

module.exports = function(Model){

  function _getInstanceHasManyRelations(Model, instanceJSON){
    var modelRelations = Model.definition.settings.relations;
    var instanceKeys = _.keys(instanceJSON);
    var instanceRelations = _.reduce(
      modelRelations,
      function(relations, relationParameters, relationName){
        if (_.indexOf(instanceKeys, relationName) >= 0 && relationParameters.type === 'hasMany'){
          relations[relationName] = relationParameters;
        }
        return relations;
      },
      {}
    );
    return instanceRelations;
  }

  function _detach(instance){
    return JSON.parse(JSON.stringify(instance));
  }

  function _getUpdateManyToManyRelationFunction(loopbackInstance, newInstance){
    return function (relation){
      var toUnlink = _.differenceBy(loopbackInstance[relation](), newInstance[relation], 'id');
      var unlinkPromises = _.map(toUnlink, function(relationItem){
        return loopbackInstance[relation].remove(relationItem);
      });

      var toLink = _.differenceBy(newInstance[relation], loopbackInstance[relation](), 'id');
      var linkPromises = _.map(toLink, function(relationItem){
        return loopbackInstance[relation].add(relationItem);
      })
      return _.concat(unlinkPromises, linkPromises);
    }
  }

  function _getUpdateOneToManyRelationFunction(loopbackInstance, newInstance){
    return function (relation, relationParameters){
      var toUnlink = _.differenceBy(loopbackInstance[relation](), newInstance[relation], 'id');
      var unlinkPromises = _.map(toUnlink, function(relationItem){
        relationItem[relationParameters.foreignKey] = null;
        return Model.app.models[relationParameters.model].upsert(relationItem);
      });

      var toLink = _.differenceBy(newInstance[relation], loopbackInstance[relation](), 'id');
      var linkPromises = _.map(toLink, function(relationItem){
        relationItem[relationParameters.foreignKey] = loopbackInstance.id;
        return Model.app.models[relationParameters.model].upsert(relationItem);
      })
      return _.concat(unlinkPromises, linkPromises);
    }
  }

  Model.deepSave = function(instance){
    return new Promise(function(resolve, reject) {

      var instanceJSON = _detach(instance);
      var instanceRelations = _getInstanceHasManyRelations(Model, instanceJSON);

      Model.upsert(instance)
      .then(function(savedInstance){
        return Model.findById(savedInstance.id, {include: _.keys(instanceRelations)});
      })
      .then(function(fullSavedInstance){
        var updateManyToManyRelation = _getUpdateManyToManyRelationFunction(fullSavedInstance, instanceJSON);
        var updateOneToManyRelation = _getUpdateOneToManyRelationFunction(fullSavedInstance, instanceJSON);
        var promises = _.reduce(
          instanceRelations,
          function(relationPromises, relationParameters, relationName){
            if (relationParameters.through){
              relationPromises = _.concat(relationPromises, updateManyToManyRelation(relationName));
            } else {
              relationPromises = _.concat(relationPromises, updateOneToManyRelation(relationName, relationParameters));
            }
            return relationPromises;
          },
          []
        );

        promises = _.concat([fullSavedInstance.id], promises);
        return Promise.all(promises);
      })
      .then(function(upatedRelations){
        var instanceId = upatedRelations[0];
        return Model.findById(instanceId, {include: _.keys(instanceRelations)});
      })
      .then(function(fullSavedInstanceWithUpdatedRelations){
        return resolve(fullSavedInstanceWithUpdatedRelations);
      })
      .catch(function(error){
        return reject(error);
      });

    });
  };
}
